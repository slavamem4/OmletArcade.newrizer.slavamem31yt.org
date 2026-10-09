package com.newrizer.arcade.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.newrizer.arcade.ui.AuthStage
import com.newrizer.arcade.ui.AuthState
import com.newrizer.arcade.ui.components.ArcadeField
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.ErrorBanner
import com.newrizer.arcade.ui.components.Hint
import com.newrizer.arcade.ui.components.Loader
import com.newrizer.arcade.ui.components.PrimaryButton
import com.newrizer.arcade.ui.theme.ArcadeColors

@Composable
fun AuthScreen(
    state: AuthState,
    onSignIn: (String, String) -> Unit,
    onSignUp: (String, String, String) -> Unit,
    onConfirmCode: (String) -> Unit,
    onResendCode: () -> Unit,
    onSignOut: () -> Unit,
) {
    if (state.stage == AuthStage.VERIFY_EMAIL) {
        VerifyEmail(state, onConfirmCode, onResendCode, onSignOut)
        return
    }

    var register by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ArcadeColors.Background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(72.dp))
        Mark()
        Spacer(Modifier.height(18.dp))
        Text(
            text = if (register) "Создать аккаунт" else "С возвращением",
            color = ArcadeColors.TextPrimary,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = "Стримы, голосовые комнаты и свои миры Minecraft",
            color = ArcadeColors.TextSecondary,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))

        if (register) {
            ArcadeField(name, { name = it }, "Никнейм")
            Spacer(Modifier.height(10.dp))
        }
        ArcadeField(email, { email = it }, "Почта")
        Spacer(Modifier.height(10.dp))
        ArcadeField(password, { password = it }, "Пароль", password = true)
        Spacer(Modifier.height(18.dp))

        if (state.error != null) {
            ErrorBanner(state.error)
            Spacer(Modifier.height(8.dp))
        }

        if (state.busy) {
            Loader(Modifier.padding(vertical = 14.dp))
        } else {
            PrimaryButton(
                text = if (register) "Зарегистрироваться" else "Войти",
                modifier = Modifier.fillMaxWidth(),
                enabled = email.isNotBlank() && password.isNotBlank() && (!register || name.isNotBlank()),
            ) {
                if (register) onSignUp(email, password, name) else onSignIn(email, password)
            }
        }

        Spacer(Modifier.height(16.dp))
        Text(
            text = if (register) "Уже есть аккаунт? Войти" else "Нет аккаунта? Создать",
            color = ArcadeColors.Coral,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable { register = !register },
        )
        Spacer(Modifier.height(36.dp))
        Hint(
            "Пароль от 8 символов. После входа придёт код подтверждения на почту — без него эфиры и звонки недоступны.",
            Modifier.padding(bottom = 40.dp),
        )
    }
}

@Composable
private fun VerifyEmail(
    state: AuthState,
    onConfirmCode: (String) -> Unit,
    onResendCode: () -> Unit,
    onSignOut: () -> Unit,
) {
    var code by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ArcadeColors.Background)
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(96.dp))
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(ArcadeColors.CoralSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ArcadeIcons.Mail, null, tint = ArcadeColors.Coral, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(20.dp))
        Text("Подтверди почту", color = ArcadeColors.TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Код из шести цифр отправлен на ${state.email}",
            color = ArcadeColors.TextSecondary,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(26.dp))

        ArcadeField(code, { if (it.length <= 6) code = it.filter(Char::isDigit) }, "000000", numeric = true)
        Spacer(Modifier.height(16.dp))

        if (state.error != null) {
            ErrorBanner(state.error)
            Spacer(Modifier.height(8.dp))
        } else if (state.notice != null) {
            Text(state.notice, color = ArcadeColors.Good, fontSize = 12.sp)
            Spacer(Modifier.height(8.dp))
        }

        if (state.busy) {
            Loader(Modifier.padding(vertical = 14.dp))
        } else {
            PrimaryButton("Подтвердить", Modifier.fillMaxWidth(), enabled = code.length == 6) {
                onConfirmCode(code)
            }
        }

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Отправить ещё раз",
                color = ArcadeColors.Coral,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onResendCode),
            )
            Spacer(Modifier.width(18.dp))
            Text(
                "Выйти",
                color = ArcadeColors.TextSecondary,
                fontSize = 13.sp,
                modifier = Modifier.clickable(onClick = onSignOut),
            )
        }
    }
}

@Composable
private fun Mark() {
    Box(
        modifier = Modifier
            .size(84.dp)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(22.dp))
            .background(ArcadeColors.Coral),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            ArcadeIcons.Gamepad,
            null,
            tint = androidx.compose.ui.graphics.Color.White,
            modifier = Modifier.size(44.dp),
        )
    }
}
