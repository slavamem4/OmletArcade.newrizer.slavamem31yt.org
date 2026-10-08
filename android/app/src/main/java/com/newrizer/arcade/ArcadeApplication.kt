package com.newrizer.arcade

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.database.FirebaseDatabase
import com.newrizer.arcade.crypto.E2EE

/**
 * Firebase is configured in code from BuildConfig instead of google-services.json
 * so the build stays reproducible and no generated file can drift out of sync.
 * These identifiers are public by design; the Realtime Database rules are the
 * actual access control.
 */
class ArcadeApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        if (FirebaseApp.getApps(this).isEmpty()) {
            val options = FirebaseOptions.Builder()
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setDatabaseUrl(BuildConfig.FIREBASE_DB_URL)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .build()
            FirebaseApp.initializeApp(this, options)
        }

        runCatching { FirebaseDatabase.getInstance().setPersistenceEnabled(false) }

        // Generates the device key pair on first launch if it does not exist.
        E2EE.initialise(this)
    }
}
