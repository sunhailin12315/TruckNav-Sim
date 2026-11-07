<script lang="ts" setup>
import SegmentedControl from "../segmentedControl.vue";

const { settings, activeSettings, updateGlobal, updateProfile } = useSettings();
const { t } = useTranslations();

const hasGuidedNavigation = computed(
    () => activeSettings.value.hasTurnNavigation === true,
);
const usesGameTime = computed(() => settings.value.routeTimeMode === "game");
const hasEventFeed = computed(() => settings.value.gameplay.eventFeed);
const hasSoundAlerts = computed(() => settings.value.gameplay.soundAlerts);

function toggleGuidedNavigation() {
    updateProfile(
        "hasTurnNavigation",
        hasGuidedNavigation.value ? false : true,
    );
}

function toggleRouteTimeMode() {
    updateGlobal("routeTimeMode", usesGameTime.value ? "real" : "game");
}

function toggleGameplayFlag(key: "eventFeed" | "soundAlerts") {
    updateGlobal("gameplay", {
        ...settings.value.gameplay,
        [key]: !settings.value.gameplay[key],
    });
}
</script>

<template>
    <div>
        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:navigation-2" size="24" />
                <p>{{ t("settings.guidedNavigation") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGuidedNavigation"
                size="normal"
                :active="hasGuidedNavigation"
            />
        </div>

        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:clock-3" size="24" />
                <p>{{ t("settings.estimatedTime") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.gameTime')"
                :right-option="t('settings.realTime')"
                @connect="toggleRouteTimeMode"
                size="normal"
                :active="usesGameTime"
            />
        </div>

        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:bell" size="24" />
                <p>{{ t("settings.eventFeed") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGameplayFlag('eventFeed')"
                size="normal"
                :active="hasEventFeed"
            />
        </div>

        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:volume-2" size="24" />
                <p>{{ t("settings.soundAlerts") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGameplayFlag('soundAlerts')"
                size="normal"
                :active="hasSoundAlerts"
            />
        </div>
    </div>
</template>
