package com.newrizer.arcade

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.newrizer.arcade.crypto.E2EE
import com.newrizer.arcade.ui.ArcadeViewModel
import com.newrizer.arcade.ui.AuthStage
import com.newrizer.arcade.ui.components.ArcadeIcons
import com.newrizer.arcade.ui.components.IconBubble
import com.newrizer.arcade.ui.components.SearchField
import com.newrizer.arcade.ui.screens.AuthScreen
import com.newrizer.arcade.ui.screens.ChatScreen
import com.newrizer.arcade.ui.screens.ComposeAction
import com.newrizer.arcade.ui.screens.ComposeSheet
import com.newrizer.arcade.ui.screens.DrawerPanel
import com.newrizer.arcade.ui.screens.EditProfileDialog
import com.newrizer.arcade.ui.screens.GamesScreen
import com.newrizer.arcade.ui.screens.GoLiveDialog
import com.newrizer.arcade.ui.screens.HomeScreen
import com.newrizer.arcade.ui.screens.HostWorldDialog
import com.newrizer.arcade.ui.screens.JoinCodeDialog
import com.newrizer.arcade.ui.screens.NewPostDialog
import com.newrizer.arcade.ui.screens.ProfileScreen
import com.newrizer.arcade.ui.screens.RoomScreen
import com.newrizer.arcade.ui.screens.SplashScreen
import com.newrizer.arcade.ui.screens.StreamsScreen
import com.newrizer.arcade.ui.screens.VoiceRoomDialog
import com.newrizer.arcade.ui.theme.ArcadeColors
import com.newrizer.arcade.ui.theme.ArcadeTheme
import kotlinx.coroutines.launch

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
    Home("Главная", ArcadeIcons.Home),
    Streams("Стрим", ArcadeIcons.Broadcast),
    Games("Игры", ArcadeIcons.Gamepad),
    Chat("Чат", ArcadeIcons.Chat),
    Profile("Профиль", ArcadeIcons.Avatar),
}

private enum class Sheet { NONE, GO_LIVE_CAMERA, GO_LIVE_SCREEN, VOICE, MINECRAFT, JOIN_CODE, POST, EDIT_PROFILE }

@Composable
private fun ArcadeApp(viewModel: ArcadeViewModel = viewModel()) {
    val auth by viewModel.auth.collectAsState()
    val feed by viewModel.feed.collectAsState()
    val search by viewModel.search.collectAsState()
    val profile by viewModel.profile.collectAsState()
    val room by viewModel.room.collectAsState()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)

    var splashDone by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf(Tab.Home) }
    var sheet by remember { mutableStateOf(Sheet.NONE) }
    var composeVisible by remember { mutableStateOf(false) }
    var postImage by remember { mutableStateOf<Uri?>(null) }
    var avatarImage by remember { mutableStateOf<Uri?>(null) }

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

    val postImagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> if (uri != null) postImage = uri }

    val avatarPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> if (uri != null) avatarImage = uri }

    LaunchedEffect(Unit) {
        viewModel.bootstrap()
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }

    if (!splashDone) {
        SplashScreen(onDone = { splashDone = true })
        return
    }

    if (!auth.signedIn || auth.stage != AuthStage.READY) {
        AuthScreen(
            state = auth,
            onSignIn = viewModel::signIn,
            onSignUp = viewModel::signUp,
            onConfirmCode = viewModel::confirmEmailCode,
            onResendCode = viewModel::requestEmailCode,
            onResetPassword = viewModel::resetPassword,
            onSignOut = viewModel::signOut,
        )
        return
    }

    if (room.roomId != null) {
        BackHandler { viewModel.leaveRoom() }
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
            onKick = viewModel::kick,
        )
        return
    }

    BackHandler(enabled = drawerState.isOpen || composeVisible || sheet != Sheet.NONE || tab != Tab.Home) {
        when {
            drawerState.isOpen -> scope.launch { drawerState.close() }
            sheet != Sheet.NONE -> sheet = Sheet.NONE
            composeVisible -> composeVisible = false
            else -> tab = Tab.Home
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = !composeVisible && sheet == Sheet.NONE,
        scrimColor = Color.Black.copy(alpha = 0.55f),
        drawerContent = {
            DrawerPanel(
                profile = profile.profile,
                uid = auth.uid,
                onOpenProfile = {
                    tab = Tab.Profile
                    scope.launch { drawerState.close() }
                },
                onOpenMissions = {
                    tab = Tab.Profile
                    scope.launch { drawerState.close() }
                },
                onOpenStats = {
                    tab = Tab.Streams
                    scope.launch { drawerState.close() }
                },
                onOpenRating = {
                    tab = Tab.Streams
                    scope.launch { drawerState.close() }
                },
                onOpenGames = {
                    tab = Tab.Games
                    scope.launch { drawerState.close() }
                },
                onInvite = {
                    scope.launch { drawerState.close() }
                    shareInvite(context)
                },
                onSignOut = {
                    scope.launch { drawerState.close() }
                    viewModel.signOut()
                },
            )
        },
    ) {
        Box(modifier = Modifier.fillMaxSize().background(ArcadeColors.Background)) {
            Column(modifier = Modifier.fillMaxSize()) {
                TopBar(
                    query = search.query,
                    onQueryChange = viewModel::onSearchChange,
                    onMenu = { scope.launch { drawerState.open() } },
                )
                Box(modifier = Modifier.weight(1f)) {
                    when (tab) {
                        Tab.Home -> HomeScreen(
                            feed = feed,
                            search = search,
                            currentUid = auth.uid.orEmpty(),
                            onRefresh = viewModel::refreshFeed,
                            onWatch = viewModel::watchStream,
                            onOpenUser = { viewModel.clearSearch() },
                            onNewPost = {
                                postImage = null
                                sheet = Sheet.POST
                            },
                            onDeletePost = viewModel::deletePost,
                        )

                        Tab.Streams -> StreamsScreen(
                            feed = feed,
                            onRefresh = viewModel::refreshFeed,
                            onWatch = viewModel::watchStream,
                            onGoLive = { sheet = Sheet.GO_LIVE_SCREEN },
                        )

                        Tab.Games -> GamesScreen(
                            feed = feed,
                            onRefresh = viewModel::refreshFeed,
                            onHost = { sheet = Sheet.MINECRAFT },
                            onJoinCode = { sheet = Sheet.JOIN_CODE },
                            onJoinSession = viewModel::joinPublicMinecraft,
                        )

                        Tab.Chat -> ChatScreen(
                            feed = feed,
                            onRefresh = viewModel::refreshFeed,
                            onCreateVoice = { sheet = Sheet.VOICE },
                            onJoinVoice = viewModel::joinVoiceRoom,
                        )

                        Tab.Profile -> ProfileScreen(
                            state = profile,
                            uid = auth.uid,
                            keyFingerprint = remember {
                                runCatching { E2EE.publicKeyId() }.getOrDefault("")
                            },
                            onEdit = {
                                avatarImage = null
                                sheet = Sheet.EDIT_PROFILE
                            },
                            onNewPost = {
                                postImage = null
                                sheet = Sheet.POST
                            },
                            onDeletePost = viewModel::deletePost,
                        )
                    }
                }
                BottomBar(
                    selected = tab,
                    onSelect = { tab = it },
                    onCompose = { composeVisible = true },
                )
            }

            ComposeSheet(
                visible = composeVisible,
                onDismiss = { composeVisible = false },
                onAction = { action ->
                    composeVisible = false
                    when (action) {
                        ComposeAction.GAMES -> tab = Tab.Games
                        ComposeAction.POST -> {
                            postImage = null
                            sheet = Sheet.POST
                        }

                        ComposeAction.GO_LIVE_CAMERA -> sheet = Sheet.GO_LIVE_CAMERA
                        ComposeAction.GO_LIVE_SCREEN -> sheet = Sheet.GO_LIVE_SCREEN
                        ComposeAction.VOICE -> sheet = Sheet.VOICE
                        ComposeAction.MINECRAFT -> sheet = Sheet.MINECRAFT
                    }
                },
            )
        }
    }

    when (sheet) {
        Sheet.NONE -> Unit

        Sheet.GO_LIVE_CAMERA, Sheet.GO_LIVE_SCREEN -> GoLiveDialog(
            camera = sheet == Sheet.GO_LIVE_CAMERA,
            onDismiss = { sheet = Sheet.NONE },
            onStart = { title, game, visibility ->
                sheet = Sheet.NONE
                viewModel.startStream(title, game, visibility)
            },
        )

        Sheet.VOICE -> VoiceRoomDialog(
            onDismiss = { sheet = Sheet.NONE },
            onCreate = { title, size ->
                sheet = Sheet.NONE
                viewModel.createVoiceRoom(title, size)
            },
        )

        Sheet.MINECRAFT -> HostWorldDialog(
            onDismiss = { sheet = Sheet.NONE },
            onHost = { create ->
                sheet = Sheet.NONE
                viewModel.hostMinecraft(create)
            },
        )

        Sheet.JOIN_CODE -> JoinCodeDialog(
            onDismiss = { sheet = Sheet.NONE },
            onJoin = { code ->
                sheet = Sheet.NONE
                viewModel.joinByCode(code)
            },
        )

        Sheet.POST -> NewPostDialog(
            image = postImage,
            onPickImage = {
                postImagePicker.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            },
            onDismiss = { sheet = Sheet.NONE },
            onPublish = { text ->
                val image = postImage
                sheet = Sheet.NONE
                postImage = null
                viewModel.publishPost(text, image)
            },
        )

        Sheet.EDIT_PROFILE -> EditProfileDialog(
            initialName = profile.profile?.displayName.orEmpty(),
            initialBio = profile.profile?.bio.orEmpty(),
            avatar = avatarImage,
            onPickAvatar = {
                avatarPicker.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            },
            onDismiss = { sheet = Sheet.NONE },
            onSave = { name, bio ->
                val avatar = avatarImage
                sheet = Sheet.NONE
                avatarImage = null
                viewModel.saveProfile(name, bio, avatar)
            },
        )
    }
}

@Composable
private fun TopBar(query: String, onQueryChange: (String) -> Unit, onMenu: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ArcadeColors.Surface)
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBubble(ArcadeIcons.Menu, "Меню", onClick = onMenu)
        Spacer(Modifier.width(10.dp))
        SearchField(query, onQueryChange, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(10.dp))
        Box {
            IconBubble(ArcadeIcons.Store, "Магазин", onClick = {})
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(ArcadeColors.Live),
            )
        }
        IconBubble(ArcadeIcons.Bell, "Уведомления", onClick = {})
        IconBubble(ArcadeIcons.Friends, "Друзья", onClick = {})
    }
}

@Composable
private fun BottomBar(selected: Tab, onSelect: (Tab) -> Unit, onCompose: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ArcadeColors.Surface)
            .navigationBarsPadding()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BarItem(Tab.Home, selected, onSelect)
        BarItem(Tab.Streams, selected, onSelect)
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(ArcadeColors.Coral)
                .clickable(onClick = onCompose),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ArcadeIcons.Plus, "Создать", tint = Color.White, modifier = Modifier.size(26.dp))
        }
        BarItem(Tab.Games, selected, onSelect)
        BarItem(Tab.Chat, selected, onSelect)
    }
}

@Composable
private fun BarItem(tab: Tab, selected: Tab, onSelect: (Tab) -> Unit) {
    val active = tab == selected
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable { onSelect(tab) }
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Icon(
            imageVector = tab.icon,
            contentDescription = tab.label,
            tint = if (active) ArcadeColors.Coral else ArcadeColors.TextSecondary,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = tab.label,
            color = if (active) ArcadeColors.TextPrimary else ArcadeColors.TextSecondary,
            fontSize = 10.5.sp,
            fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

private fun shareInvite(context: Context) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(
            Intent.EXTRA_TEXT,
            "Заходи в Arcade: стримы, голосовые комнаты и миры Minecraft в одной сети.",
        )
    }
    runCatching { context.startActivity(Intent.createChooser(intent, "Пригласить друзей")) }
}
