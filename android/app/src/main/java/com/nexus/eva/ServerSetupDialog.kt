package com.nexus.eva

import android.content.Context
import android.graphics.Typeface
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Native Material 3 Bottom Sheet for picking, testing, and saving the Nexus Eva server URL.
 * Supports Cloud HTTPS deployments, local Wi-Fi LAN IPs, and USB ADB reverse tunnels.
 */
class ServerSetupDialog(
    private val context: Context,
    private val serverPrefs: ServerPrefs,
    private val scope: CoroutineScope,
    private val cancelable: Boolean,
    private val onConnect: (String) -> Unit,
) {
    private var probeJob: Job? = null

    fun show() {
        val dialog = BottomSheetDialog(context)
        dialog.setCancelable(cancelable)
        dialog.setCanceledOnTouchOutside(cancelable)

        val pad = dp(20)
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(12), pad, dp(24))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        // Material 3 Drag Handle
        val dragHandle = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(dp(36), dp(4)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(16)
            }
            setBackgroundColor(ContextCompat.getColor(context, R.color.nexus_on_surface_muted))
            alpha = 0.45f
        }
        container.addView(dragHandle)

        val titleView = TextView(context).apply {
            text = context.getString(R.string.server_picker_title)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(typeface, Typeface.BOLD)
        }
        container.addView(titleView)

        val subtitleView = TextView(context).apply {
            text = context.getString(R.string.server_picker_subtitle)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            alpha = 0.72f
            setPadding(0, dp(4), 0, dp(14))
        }
        container.addView(subtitleView)

        // URL Input Field
        val inputLayout = TextInputLayout(context).apply {
            hint = context.getString(R.string.server_url_hint)
            boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            setBoxCornerRadii(dp(14).toFloat(), dp(14).toFloat(), dp(14).toFloat(), dp(14).toFloat())
        }
        val editText = TextInputEditText(inputLayout.context).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
            setText(serverPrefs.getActiveUrl() ?: ServerPrefs.PRESET_USB_ADB)
        }
        inputLayout.addView(editText)
        container.addView(inputLayout)

        // Quick-connect presets (USB ADB, Emulator, LAN Template)
        val presetsLabel = TextView(context).apply {
            text = "Quick Connect Presets"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            setTypeface(typeface, Typeface.BOLD)
            alpha = 0.65f
            setPadding(0, dp(14), 0, dp(6))
        }
        container.addView(presetsLabel)

        val quickChips = ChipGroup(context).apply {
            isSingleSelection = false
        }
        val presets = listOf(
            "USB ADB (127.0.0.1:3000)" to ServerPrefs.PRESET_USB_ADB,
            "Wi-Fi LAN (192.168.1.100)" to ServerPrefs.PRESET_LAN_TEMPLATE,
            "Emulator (10.0.2.2:3000)" to ServerPrefs.PRESET_EMULATOR_HOST,
        )
        presets.forEach { (label, url) ->
            val chip = Chip(context).apply {
                text = label
                isCheckable = false
                setOnClickListener {
                    editText.setText(url)
                    editText.setSelection(url.length)
                }
            }
            quickChips.addView(chip)
        }
        container.addView(quickChips)

        // Saved Server History
        val savedUrls = serverPrefs.getSavedUrls()
        if (savedUrls.isNotEmpty()) {
            val savedLabel = TextView(context).apply {
                text = "Saved Servers"
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                setTypeface(typeface, Typeface.BOLD)
                alpha = 0.65f
                setPadding(0, dp(12), 0, dp(6))
            }
            container.addView(savedLabel)

            val savedChips = ChipGroup(context)
            savedUrls.forEach { savedUrl ->
                val chip = Chip(context).apply {
                    text = savedUrl.removePrefix("https://").removePrefix("http://")
                    isCloseIconVisible = true
                    setOnClickListener {
                        editText.setText(savedUrl)
                        editText.setSelection(savedUrl.length)
                    }
                    setOnCloseIconClickListener {
                        serverPrefs.removeSavedUrl(savedUrl)
                        savedChips.removeView(this)
                    }
                }
                savedChips.addView(chip)
            }
            container.addView(savedChips)
        }

        // Live health test status text
        val statusView = TextView(context).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            setPadding(0, dp(12), 0, dp(4))
            visibility = View.GONE
        }
        container.addView(statusView)

        // Action row: Test Connection + Connect
        val buttonRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(14), 0, 0)
        }

        val testBtn = MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = context.getString(R.string.btn_test_connection)
            layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f).apply {
                marginEnd = dp(8)
            }
        }

        val connectBtn = MaterialButton(context).apply {
            text = context.getString(R.string.btn_connect)
            layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f)
        }

        testBtn.setOnClickListener {
            val raw = editText.text?.toString().orEmpty()
            statusView.visibility = View.VISIBLE
            statusView.text = "Checking /api/health…"
            statusView.setTextColor(ContextCompat.getColor(context, R.color.nexus_primary))
            probeJob?.cancel()
            probeJob = scope.launch {
                val res = ServerPrefs.probeHealth(raw)
                statusView.text = if (res.ok) "✓ ${res.message}" else "✕ ${res.message}"
                statusView.setTextColor(
                    ContextCompat.getColor(
                        context,
                        if (res.ok) R.color.nexus_primary else R.color.nexus_error
                    )
                )
                if (res.ok) {
                    editText.setText(res.normalizedUrl)
                    editText.setSelection(res.normalizedUrl.length)
                }
            }
        }

        connectBtn.setOnClickListener {
            val raw = editText.text?.toString().orEmpty()
            val normalized = ServerPrefs.normalizeUrl(raw)
            if (normalized.isEmpty()) {
                inputLayout.error = "Enter a valid http:// or https:// server URL"
                return@setOnClickListener
            }
            inputLayout.error = null
            val saved = serverPrefs.setActiveUrl(normalized)
            dialog.dismiss()
            onConnect(saved)
        }

        buttonRow.addView(testBtn)
        buttonRow.addView(connectBtn)
        container.addView(buttonRow)

        dialog.setOnDismissListener { probeJob?.cancel() }
        dialog.setContentView(container)
        dialog.show()
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics
        ).toInt()
}
