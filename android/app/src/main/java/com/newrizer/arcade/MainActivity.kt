package com.newrizer.arcade

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.newrizer.arcade.crypto.E2EE
import com.newrizer.arcade.ui.ArcadeViewModel
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.screens.AuthScreen
import com.newrizer.arcade.ui.screens.HomeScreen
import com.newrizer.arcade.ui.screens.MinecraftScreen
import com.newrizer.arcade.ui.screens.ProfileScreen
import com.newrizer.arcade.ui.screens.RoomScreen
import com.newrizer.arcade.ui.screens.VoiceScreen
import com.newrizer.arcade.ui.theme.ArcadeColors
import com.newrizer.arcade.ui.theme.ArcadeTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ArcadeTheme {
                Box(modifier = Modifier.fillMaxSize().background(ArcadeColors.Background)) {
                    ArcadeApp()
                }
            }
        }
    }
}

private enum class Tab(val label: String, val icon: ImageVector) {
    Home("Live", ArcadeIcons.Home),
    Minecraft("Worlds", ArcadeIcons.Cube),
    Voice("Voice", ArcadeIcons.Waves),
    Profile("You", ArcadeIcons.Profile),
}

@Composable
private fun ArcadeApp(viewModel: ArcadeViewModel = viewModel()) {
    val auth by viewModel.auth.collectAsState()
    val feed by viewModel.feed.collectAsState()
    val room by viewModel.room.collectAsState()
    val profile by viewModel.profile.collectAsState()
    var tab by remember { mutableStateOf(Tab.Home) }

    val context = androidx.compose.ui.platform.LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { }

    val projectionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            viewModel.startScreenShare(data)
        }
    }

    LaunchedEffect(Unit) {
        viewModel.bootstrap()
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }

    if (!auth.signedIn) {
        AuthScreen(
            state = auth,
            onSignIn = viewModel::signIn,
            onSignUp = viewModel::signUp,
        )
        return
    }

    if (room.roomId != null) {
        RoomScreen(
            state = room,
            selfUid = auth.uid,
            onLeave = viewModel::leaveRoom,
            onToggleMic = viewModel::toggleMicrophone,
            onRequestScreenShare = {
                val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                    as MediaProjectionManager
                projectionLauncher.launch(manager.createScreenCaptureIntent())
            },
            onStopScreenShare = viewModel::stopScreenShare,
            onSend = viewModel::sendMessage,
        )
        return
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f)) {
            when (tab) {
                Tab.Home -> HomeScreen(
                    feed = feed,
                    onRefresh = viewModel::refreshFeed,
                    onWatch = viewModel::watchStream,
                    onGoLive = viewModel::startStream,
                )

                Tab.Minecraft -> MinecraftScreen(
                    feed = feed,
                    onRefresh = viewModel::refreshFeed,
                    onHost = viewModel::hostMinecraft,
                    onJoinCode = viewModel::joinMinecraft,
                    onJoinSession = viewModel::joinPublicMinecraft,
                )

                Tab.Voice -> VoiceScreen(
                    feed = feed,
                    onRefresh = viewModel::refreshFeed,
                    onJoin = viewModel::joinVoiceRoom,
                    onCreate = viewModel::createVoiceRoom,
                )

                Tab.Profile -> ProfileScreen(
                    profile = profile,
                    uid = auth.uid,
                    keyFingerprint = remember { runCatching { E2EE.publicKeyId() }.getOrDefault("") },
                    onSave = viewModel::saveProfile,
                    onSignOut = viewModel::signOut,
                )
            }
        }
        BottomBar(selected = tab, onSelect = { tab = it })
    }
}

@Composable
private fun BottomBar(selected: Tab, onSelect: (Tab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ArcadeColors.Surface)
            .padding(vertical = 10.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceEvenly,
    ) {
        Tab.entries.forEach { entry ->
            val active = entry == selected
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .selectable(selected = active, onClick = { onSelect(entry) })
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            ) {
                Icon(
                    imageVector = entry.icon,
                    contentDescription = entry.label,
                    tint = if (active) ArcadeColors.Amber else ArcadeColors.TextSecondary,
                    modifier = Modifier.size(22.dp),
                )
                Text(
                    text = entry.label,
                    color = if (active) ArcadeColors.TextPrimary else ArcadeColors.TextSecondary,
                    fontSize = 11.sp,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
    }
}
