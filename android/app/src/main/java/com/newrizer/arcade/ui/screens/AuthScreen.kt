package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.AuthState
import com.newrizer.arcade.ui.components.ArcadeButton
import com.newrizer.arcade.ui.components.ArcadeField
import com.newrizer.arcade.ui.components.ArcadeLoader
import com.newrizer.arcade.ui.components.ButtonTone
import com.newrizer.arcade.ui.components.ErrorBanner
import com.newrizer.arcade.ui.theme.ArcadeColors

/** The shell-and-yolk mark, drawn at any size without a bitmap asset. */
@Composable
fun ArcadeMark(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 72.dp) {
    Canvas(modifier = modifier.size(size)) {
        val width = this.size.width
        val height = this.size.height
        val shell = Path().apply {
            moveTo(width * 0.5f, height * 0.08f)
            cubicTo(
                width * 0.84f, height * 0.08f,
                width * 0.95f, height * 0.52f,
                width * 0.95f, height * 0.66f,
            )
            cubicTo(
                width * 0.95f, height * 0.88f,
                width * 0.75f, height * 0.97f,
                width * 0.5f, height * 0.97f,
            )
            cubicTo(
                width * 0.25f, height * 0.97f,
                width * 0.05f, height * 0.88f,
                width * 0.05f, height * 0.66f,
            )
            cubicTo(
                width * 0.05f, height * 0.52f,
                width * 0.16f, height * 0.08f,
                width * 0.5f, height * 0.08f,
            )
            close()
        }
        drawPath(shell, ArcadeColors.Shell)
        drawCircle(
            color = ArcadeColors.Amber,
            radius = width * 0.22f,
            center = Offset(width * 0.5f, height * 0.52f),
        )
        val arm = width * 0.055f
        val span = width * 0.135f
        drawRect(
            color = ArcadeColors.Background,
            topLeft = Offset(width * 0.5f - span, height * 0.52f - arm),
            size = Size(span * 2, arm * 2),
        )
        drawRect(
            color = ArcadeColors.Background,
            topLeft = Offset(width * 0.5f - arm, height * 0.52f - span),
            size = Size(arm * 2, span * 2),
        )
    }
}

@Composable
fun AuthScreen(
    state: AuthState,
    onSignIn: (String, String) -> Unit,
    onSignUp: (String, String, String) -> Unit,
) {
    var register by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ArcadeMark(size = 84.dp)
        Spacer(Modifier.height(18.dp))
        Text("ARCADE", color = ArcadeColors.TextPrimary, fontSize = 30.sp, fontWeight = FontWeight.Black)
        Text(
            "Stream, host and talk. Encrypted end to end.",
            color = ArcadeColors.TextSecondary,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(32.dp))

        if (register) {
            ArcadeField(displayName, { displayName = it }, "Display name")
            Spacer(Modifier.height(12.dp))
        }
        ArcadeField(email, { email = it }, "Email", keyboardType = KeyboardType.Email)
        Spacer(Modifier.height(12.dp))
        ArcadeField(password, { password = it }, "Password", isPassword = true, keyboardType = KeyboardType.Password)

        Spacer(Modifier.height(16.dp))
        ErrorBanner(state.error)
        Spacer(Modifier.height(16.dp))

        if (state.busy) {
            ArcadeLoader()
        } else {
            val valid = email.contains('@') && password.length >= 8 &&
                (!register || displayName.trim().length >= 2)
            ArcadeButton(
                text = if (register) "Create account" else "Sign in",
                onClick = {
                    if (register) onSignUp(email, password, displayName) else onSignIn(email, password)
                },
                enabled = valid,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            ArcadeButton(
                text = if (register) "I already have an account" else "Create a new account",
                onClick = { register = !register },
                tone = ButtonTone.Neutral,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
            Box(modifier = Modifier.padding(horizontal = 8.dp)) {
                Text(
                    "Passwords need at least 8 characters.",
                    color = ArcadeColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
        }
    }
}
