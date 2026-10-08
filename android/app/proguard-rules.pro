# LiveKit / WebRTC
-keep class org.webrtc.** { *; }
-keep class io.livekit.android.** { *; }
-dontwarn org.webrtc.**

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Tink
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**
-dontwarn com.google.api.client.**
-dontwarn javax.annotation.**
-dontwarn org.joda.time.**

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.newrizer.arcade.data.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class com.newrizer.arcade.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Never keep debug logging in release
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}
