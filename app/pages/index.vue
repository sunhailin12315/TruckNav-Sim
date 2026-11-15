<script lang="ts" setup>
import { SafeArea, SystemBarsType } from "@capacitor-community/safe-area";

const { isElectron, isMobile } = usePlatform();
const { settings } = useSettings();
const { settings: desktopSettings } = useDesktopSettings();

const currentView = ref<string>("");

onMounted(() => {
    setTimeout(updateSystemBars, 500);
    window.addEventListener("resize", updateSystemBars);

    if (isElectron.value) {
        // 自动开始导航开启且已选游戏:跳过首页直接进地图。
        if (
            desktopSettings.value.autoStartNavigation &&
            settings.value.selectedGame
        ) {
            currentView.value = "map";
        } else {
            currentView.value = "desktopHome";
        }
    } else {
        if (settings.value.autoStartNav && settings.value.selectedGame) {
            currentView.value = "map";
        } else {
            currentView.value = "gameManager";
        }
    }
});

onUnmounted(() => {
    window.removeEventListener("resize", updateSystemBars);
});

watch(currentView, async () => {
    await nextTick();
    updateSystemBars();

    if (isElectron.value && currentView.value === "desktopHome") {
        (window as any).electronAPI.setWindowSize(950, 700, false, false);
    }
});

const updateSystemBars = async () => {
    if (!isMobile.value) return;

    try {
        const isLandscape = window.innerWidth > window.innerHeight;

        if (isLandscape) {
            await SafeArea.hideSystemBars({ type: SystemBarsType.StatusBar });
            await SafeArea.hideSystemBars({
                type: SystemBarsType.NavigationBar,
            });
        } else {
            await SafeArea.showSystemBars({ type: SystemBarsType.StatusBar });
            await SafeArea.hideSystemBars({
                type: SystemBarsType.NavigationBar,
            });
        }
    } catch (e) {
        console.error("Bars update failed", e);
    }
};

const launchGameManager = () => {
    // 自动开始导航直达地图后,首页常驻组件迟到的配对成功事件
    // 不得把视图从地图拽回配对页。
    if (currentView.value === "map") return;
    currentView.value = "gameManager";
};
const launchMap = () => (currentView.value = "map");
const goToDesktopIndex = () => (currentView.value = "desktopHome");

const goHome = () => {
    if (isElectron.value) currentView.value = "desktopHome";
    else currentView.value = "gameManager";
};
</script>

<template>
    <template v-if="isElectron">
        <Transition name="page-fade">
            <DesktopIndex
                v-show="currentView === 'desktopHome'"
                @connected="launchGameManager"
            />
        </Transition>
    </template>

    <Transition name="page-fade">
        <GameManager
            v-show="currentView === 'gameManager'"
            @go-back="goToDesktopIndex"
            @connected="launchMap"
        />
    </Transition>

    <Transition name="page-fade">
        <LazyMap
            v-if="currentView === 'map'"
            :goHome="goHome"
            :key="settings.selectedGame ?? 'none'"
        />
    </Transition>
</template>
