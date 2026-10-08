package com.newrizer.arcade.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.newrizer.arcade.MainActivity
import com.newrizer.arcade.R

/**
 * Foreground service that keeps a broadcast alive while the user is in another
 * app. It owns no media itself; it only satisfies the platform requirement
 * that screen capture runs in a visible foreground service.
 */
class BroadcastService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.broadcast_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            )
            channel.setShowBadge(false)
            manager.createNotificationChannel(channel)
        }

        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.broadcast_notification_title))
            .setContentText(getString(R.string.broadcast_notification_text))
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL_ID = "arcade_broadcast"
        private const val NOTIFICATION_ID = 4201

        fun start(context: android.content.Context) {
            val intent = Intent(context, BroadcastService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: android.content.Context) {
            context.stopService(Intent(context, BroadcastService::class.java))
        }
    }
}
