package com.newrizer.arcade.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Keeps the signed proof that this account's address was confirmed.
 *
 * The proof is scoped to one uid and signed by the backend, so it is useless
 * on another account or another device-forged request. It lives in app-private
 * storage and is dropped on sign-out.
 */
object EmailProofStore {

    private const val FILE = "arcade_email"
    private const val KEY_PROOF = "proof"
    private const val KEY_UID = "uid"

    private lateinit var prefs: SharedPreferences

    fun initialise(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    fun save(uid: String, proof: String) {
        prefs.edit().putString(KEY_UID, uid).putString(KEY_PROOF, proof).apply()
    }

    fun proofFor(uid: String?): String? {
        if (uid == null || !this::prefs.isInitialized) return null
        if (prefs.getString(KEY_UID, null) != uid) return null
        return prefs.getString(KEY_PROOF, null)
    }

    fun clear() {
        if (this::prefs.isInitialized) prefs.edit().clear().apply()
    }
}
