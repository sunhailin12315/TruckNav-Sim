<script lang="ts" setup>
import SegmentedControl from "../segmentedControl.vue";
import { BEEP_STYLES } from "~/assets/utils/shared/settingsSchema";
import {
    AUTO_VOICE,
    voicesForLocale,
} from "~/assets/utils/guidance/voiceSelection";
import type { BeepStyle } from "~/composables/Settings";

const { settings, activeSettings, updateGlobal, updateProfile } = useSettings();
const { t } = useTranslations();
const { previewBeep } = useSoundAlerts();
const {
    previewVoice,
    localeVoices,
} = useVoiceGuidance();

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

const beepStyleItems = computed(() =>
    BEEP_STYLES.map((style) => t(`settings.beepStyleOptions.${style}`)),
);
const currentBeepStyleLabel = computed(() =>
    t(`settings.beepStyleOptions.${settings.value.gameplay.beepStyle}`),
);

function updateBeepStyle(label: string) {
    const index = beepStyleItems.value.indexOf(label);
    if (index < 0) return;
    updateGlobal("gameplay", {
        ...settings.value.gameplay,
        beepStyle: BEEP_STYLES[index] as BeepStyle,
    });
    // Pick up the new timbre right away, like a ringtone preview.
    previewBeep();
}

// Auto first, then the voices usable for the app language (name + tag).
const voiceItems = computed(() => [
    t("settings.voiceNameAuto"),
    ...localeVoices.value.map((v) => `${v.name} (${v.lang})`),
]);
const currentVoiceLabel = computed(() => {
    const wanted = settings.value.gameplay.voiceName;
    if (wanted === AUTO_VOICE) return t("settings.voiceNameAuto");
    const picked = localeVoices.value.find((v) => v.voiceURI === wanted);
    // Stored voice no longer in the list: show its raw id rather than lie.
    return picked
        ? `${picked.name} (${picked.lang})`
        : wanted;
});

function updateVoiceName(label: string) {
    const index = voiceItems.value.indexOf(label);
    if (index < 0) return;
    updateGlobal("gameplay", {
        ...settings.value.gameplay,
        voiceName:
            index === 0 ? AUTO_VOICE : localeVoices.value[index - 1]!.voiceURI,
    });
    // Speak a fixed cue through the newly picked voice right away.
    previewVoice(t("voice.arrived"));
}

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

        <div v-if="hasSoundAlerts" class="option setting">
            <div class="option-title">
                <Icon name="lucide:music-2" size="24" />
                <p>{{ t("settings.beepStyle") }}</p>
            </div>

            <USelect
                :model-value="currentBeepStyleLabel"
                @update:model-value="(val: string) => updateBeepStyle(val)"
                :items="beepStyleItems"
                variant="none"
                class="selector"
                :ui="{
                    trailingIcon: 'shrink-0 size-[20px] text-white !px-6',
                    content: 'bg-[#222e3c] shadow-xl rounded-md',
                    item: 'flex items-center justify-between text-[1.6rem] font-BOLD !py-2 !px-3 text-[#f2f2f2] data-[highlighted]:bg-[#3d546e] rounded cursor-pointer transition-colors',
                    itemTrailingIcon: 'text-white',
                }"
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
                <Icon name="lucide:mic" size="24" />
                <p>{{ t("settings.voiceName") }}</p>
            </div>

            <USelect
                :model-value="currentVoiceLabel"
                @update:model-value="(val: string) => updateVoiceName(val)"
                :items="voiceItems"
                variant="none"
                class="selector"
                :ui="{
                    trailingIcon: 'shrink-0 size-[20px] text-white !px-6',
                    content: 'bg-[#222e3c] shadow-xl rounded-md',
                    item: 'flex items-center justify-between text-[1.6rem] font-BOLD !py-2 !px-3 text-[#f2f2f2] data-[highlighted]:bg-[#3d546e] rounded cursor-pointer transition-colors',
                    itemTrailingIcon: 'text-white',
                }"
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
