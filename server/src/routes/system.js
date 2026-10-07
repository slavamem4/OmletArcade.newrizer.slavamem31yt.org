'use strict';
/**
 * /api/system — health, purge, and the webhook that LiveKit calls back into.
 *
 * The webhook is the only endpoint with a raw body: the signature covers the
 * exact bytes, so it must be verified before anything parses them.
 */
const express = require('express');
const { db, sql } = require('../db');
const errors = require('../errors');
const auth = require('../middleware/auth');
const purge = require('../services/purge');
const livekit = require('../services/livekit');
const realtime = require('../realtime');
const parties = require('../services/parties');
const rateLimit = require('../security/rate-limit');
const logger = require('../logger');
const audit = require('../services/audit');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    time: Date.now(),
    uptimeSeconds: Math.round(process.uptime()),
    version: '1.0.0',
    concurrency: rateLimit.concurrency(),
  });
});

/** Ready probe for the platform: fails when storage is not usable. */
router.get('/ready', errors.wrap(async (req, res) => {
  const row = await db().get(`SELECT 1 AS ok`);
  if (!row) throw errors.unavailable('Storage is not ready', 3);
  res.json({ ok: true, driver: db().name });
}));

router.get('/purge/report', auth.required(), errors.wrap(async (req, res) => {
  res.json(await purge.report());
}));

/**
 * Deep purge: caches, expired rows, log ring, log file, limiter state.
 * Available to any signed-in user for their own device space, and to staff for
 * the server side. The server side is what "clear everything" means in the app.
 */
router.post('/purge', auth.required(), errors.wrap(async (req, res) => {
  const staff = req.user.role === 'admin' || req.user.role === 'mod';
  const stats = await purge.run({ deep: true });
  await audit.record({ actorId: req.user.id, action: staff ? 'system.purge' : 'system.purge_self', ip: req.clientIp });
  if (!staff) {
    // A normal user asked to clear their space: report only what belongs to
    // them plus the shared cache totals, not the full server inventory.
    res.json({
      ok: true,
      cleared: {
        messages: stats.messages,
        notifications: stats.notifications,
        cacheEntries: stats.cacheEntries,
        logRing: stats.logRing,
      },
      heapUsedMb: stats.heapUsedMb,
    });
    return;
  }
  res.json({ ok: true, stats });
}));

/* -------------------------------------------------------- LiveKit webhook */

const webhook = express.Router();

webhook.post('/', errors.wrap(async (req, res) => {
  if (!livekit.assertConfigured()) throw errors.unavailable('Voice is not configured on this server', 30);
  const signature = req.get('authorization');
  let event;
  try {
    event = await livekit.receiveWebhook(req.rawBody, signature);
  } catch (err) {
    // Bad signature: this is either a misconfiguration or a probe. Count it
    // against the source so a signature-spam loop gets banned.
    rateLimit.penalize(`ip:${req.clientIp}`, require('../config').config.limits, { immediate: true });
    logger.warn('webhook: signature verification failed', { ip: req.clientIp, message: err.message });
    throw errors.unauthorized('Webhook signature did not verify');
  }

  const room = event.room ? event.room.name : null;
  const kind = room ? room.split('-')[0] : null;
  const participant = event.participant ? event.participant.identity : null;
  const userId = participant && /^u\d+$/.test(participant) ? Number(participant.slice(1)) : null;

  switch (event.event) {
    case 'participant_joined': {
      if (room && userId) {
        const party = await db().get(`SELECT id FROM parties WHERE room_name = ?`, [room]);
        if (party) {
          realtime.joinParty(userId, Number(party.id));
          await parties.addEvent(Number(party.id), userId, 'voice_joined');
        }
      }
      break;
    }
    case 'participant_left': {
      if (room && userId) {
        const party = await db().get(`SELECT id FROM parties WHERE room_name = ?`, [room]);
        if (party) await parties.addEvent(Number(party.id), userId, 'voice_left');
        realtime.leaveParty(userId);
      }
      break;
    }
    case 'track_published':
    case 'track_unpublished': {
      if (room && userId) {
        const party = await db().get(`SELECT id FROM parties WHERE room_name = ?`, [room]);
        if (party) {
          await parties.addEvent(Number(party.id), userId, event.event === 'track_published' ? 'track_on' : 'track_off', {
            kind: event.track ? event.track.type : null,
          });
        }
      }
      break;
    }
    case 'room_finished': {
      if (room) {
        const party = await db().get(`SELECT * FROM parties WHERE room_name = ?`, [room]);
        if (party) {
          await parties.close(Number(party.id), Number(party.owner_id), { silent: true });
          if (kind === 'broadcast') {
            await db().run(`UPDATE broadcasts SET live = ?, ended_at = ? WHERE party_id = ?`, [sql.bool(false), Date.now(), Number(party.id)]);
          }
        }
      }
      break;
    }
    default:
      break;
  }
  res.json({ ok: true });
}));

router.use('/webhooks/livekit', webhook);

module.exports = router;
