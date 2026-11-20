# Preserve @JavascriptInterface methods for the WebView <-> Kotlin EvaJsBridge
-keepattributes JavascriptInterface
-keepclassmembers class com.nexus.eva.EvaJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
