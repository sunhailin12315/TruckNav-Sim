<script lang="ts" setup>
import SegmentedControl from "../segmentedControl.vue";

const { settings, activeSettings, updateGlobal, updateProfile } = useSettings();
const { t } = useTranslations();

const hasGuidedNavigation = computed(
    () => activeSettings.value.hasTurnNavigation === true,
);
const avoidsFerries = computed(() => activeSettings.value.avoidFerries);
const avoidsTolls = computed(() => activeSettings.value.avoidTolls);
const usesGameTime = computed(() => settings.value.routeTimeMode === "game");
const hasEventFeed = computed(() => settings.value.gameplay.eventFeed);
const hasSoundAlerts = computed(() => settings.value.gameplay.soundAlerts);
const hasUrbanWarning = computed(() => settings.value.gameplay.urbanWarning);
const hasVoiceNavigation = computed(
    () => settings.value.gameplay.voiceNavigation,
);
const hasVoiceConcise = computed(() => settings.value.gameplay.voiceConcise);
const hasVoiceNeural = computed(() => settings.value.gameplay.voiceNeural);

function toggleGuidedNavigation() {
    updateProfile(
        "hasTurnNavigation",
        hasGuidedNavigation.value ? false : true,
    );
}

function toggleAvoidFerries() {
    updateProfile("avoidFerries", avoidsFerries.value ? false : true);
}

function toggleAvoidTolls() {
    updateProfile("avoidTolls", avoidsTolls.value ? false : true);
}

function toggleRouteTimeMode() {
    updateGlobal("routeTimeMode", usesGameTime.value ? "real" : "game");
}

function toggleGameplayFlag(
    key:
        | "eventFeed"
        | "soundAlerts"
        | "urbanWarning"
        | "voiceNavigation"
        | "voiceConcise"
        | "voiceNeural",
) {
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
                <Icon name="lucide:ship" size="24" />
                <p>{{ t("settings.avoidFerries") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleAvoidFerries"
                size="normal"
                :active="avoidsFerries"
            />
        </div>

        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:receipt" size="24" />
                <p>{{ t("settings.avoidTolls") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleAvoidTolls"
                size="normal"
                :active="avoidsTolls"
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

        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:building-2" size="24" />
                <p>{{ t("settings.urbanWarning") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGameplayFlag('urbanWarning')"
                size="normal"
                :active="hasUrbanWarning"
            />
        </div>

        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:speech" size="24" />
                <p>{{ t("settings.voiceNavigation") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGameplayFlag('voiceNavigation')"
                size="normal"
                :active="hasVoiceNavigation"
            />
        </div>

        <div v-if="hasVoiceNavigation" class="option setting">
            <div class="option-title">
                <Icon name="lucide:brain-circuit" size="24" />
                <p>{{ t("settings.voiceNeural") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGameplayFlag('voiceNeural')"
                size="normal"
                :active="hasVoiceNeural"
            />
        </div>

        <div v-if="hasVoiceNavigation" class="option setting">
            <div class="option-title">
                <Icon name="lucide:message-square-text" size="24" />
                <p>{{ t("settings.voiceConcise") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleGameplayFlag('voiceConcise')"
                size="normal"
                :active="hasVoiceConcise"
            />
        </div>
    </div>
</template>
