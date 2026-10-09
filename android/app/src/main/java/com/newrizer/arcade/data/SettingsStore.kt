package com.newrizer.arcade.data

import android.content.Context
import android.content.SharedPreferences

/** Local-only preferences. Nothing here leaves the device. */
object SettingsStore {

    private const val FILE = "arcade_settings"

    private lateinit var prefs: SharedPreferences

    fun initialise(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    private fun ready() = this::prefs.isInitialized

    var notifications: Boolean
        get() = !ready() || prefs.getBoolean("notifications", true)
        set(value) { if (ready()) prefs.edit().putBoolean("notifications", value).apply() }

    /** true = play previews on Wi-Fi only. */
    var autoplayWifiOnly: Boolean
        get() = !ready() || prefs.getBoolean("autoplay_wifi", true)
        set(value) { if (ready()) prefs.edit().putBoolean("autoplay_wifi", value).apply() }

    fun reset() {
        if (ready()) prefs.edit().clear().apply()
    }
}
