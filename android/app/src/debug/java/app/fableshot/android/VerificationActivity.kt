package app.fableshot.android

/** Isolated Compose fixture host. No route from the normal app; absent from release APKs. */
class VerificationActivity:androidx.activity.ComponentActivity() {
    override fun onCreate(savedInstanceState:android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
