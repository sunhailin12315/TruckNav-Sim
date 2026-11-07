<script setup lang="ts">
import { KeepAwake } from "@capacitor-community/keep-awake";

onMounted(async () => {
    const { initSettings } = useSettings();
    initSettings();

    // Owns the theme/text CSS variables (day/night aware); must run after
    // settings are loaded so the first paint uses the saved palette.
    useDayNight();

    const { initDesktopSettings } = useDesktopSettings();
    await initDesktopSettings();

    const result = await KeepAwake.isSupported();
    if (result.isSupported) {
        await KeepAwake.keepAwake();
    }
});
</script>

<template>
    <UApp>
        <NuxtLayout>
            <NuxtPage />
        </NuxtLayout>
    </UApp>
</template>

<style lang="scss">
@use "~/assets/scss/global/global";
</style>
