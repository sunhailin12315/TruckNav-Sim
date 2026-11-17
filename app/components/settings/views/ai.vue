<script lang="ts" setup>
import SegmentedControl from "../segmentedControl.vue";
import {
    AI_VOICE_STYLES,
    DEFAULT_AI_ENDPOINT,
    DEFAULT_AI_MODEL,
} from "~/assets/utils/shared/settingsSchema";
import {
    missingAiConfigFields,
    testAiConnection,
} from "~/assets/utils/ai/aiClient";
import { aiUsageTokens } from "~/composables/useAI";
import type { AiVoiceStyle } from "~/composables/Settings";

const { settings, updateGlobal } = useSettings();
const { t } = useTranslations();

const hasAi = computed(() => settings.value.ai.aiEnabled);
const hasDriveReport = computed(() => settings.value.ai.aiDriveReport);
const hasInsights = computed(() => settings.value.ai.aiInsights);
const hasServiceNote = computed(() => settings.value.ai.aiServiceNote);

// Provider presets fill endpoint (+ a known default model) in one pick;
// local runtimes only preset the endpoint — the model is whatever the
// user has pulled locally.
const AI_PROVIDER_PRESETS = [
    {
        id: "deepseek",
        endpoint: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
    },
    {
        id: "qwen",
        endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus",
    },
    {
        id: "glm",
        endpoint: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4-flash",
    },
    {
        id: "openai",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
    },
    { id: "ollama", endpoint: "http://localhost:11434/v1", model: "" },
    { id: "lmstudio", endpoint: "http://localhost:1234/v1", model: "" },
] as const;

const presetItems = computed(() => [
    ...AI_PROVIDER_PRESETS.map((preset) =>
        t(`settings.aiPreset.${preset.id}`),
    ),
    t("settings.aiPresetCustom"),
]);

const currentPresetLabel = computed(() => {
    const ai = settings.value.ai;
    const matched = AI_PROVIDER_PRESETS.find(
        (preset) =>
            preset.endpoint === ai.aiEndpoint &&
            (preset.model === "" || preset.model === ai.aiModel),
    );
    return matched
        ? t(`settings.aiPreset.${matched.id}`)
        : t("settings.aiPresetCustom");
});

function applyPreset(label: string) {
    const index = presetItems.value.indexOf(label);
    if (index < 0 || index === AI_PROVIDER_PRESETS.length) return; // custom

    const preset = AI_PROVIDER_PRESETS[index]!;
    patchAi({ aiEndpoint: preset.endpoint });
    endpointInput.value = preset.endpoint;
    if (preset.model) {
        patchAi({ aiModel: preset.model });
        modelInput.value = preset.model;
    }
    resetTestState();
}

// Text fields commit on change (blur/Enter), like the IP input; the stored
// value stays the source of truth and refreshes the field when it moves.
const endpointInput = ref(settings.value.ai.aiEndpoint);
const keyInput = ref(settings.value.ai.aiApiKey);
const modelInput = ref(settings.value.ai.aiModel);

watch(
    () => settings.value.ai.aiEndpoint,
    (value) => (endpointInput.value = value),
);
watch(
    () => settings.value.ai.aiApiKey,
    (value) => (keyInput.value = value),
);
watch(
    () => settings.value.ai.aiModel,
    (value) => (modelInput.value = value),
);

function patchAi(patch: Partial<typeof settings.value.ai>) {
    updateGlobal("ai", { ...settings.value.ai, ...patch });
}

function commitEndpoint() {
    const value = endpointInput.value.trim();
    const stored = value || DEFAULT_AI_ENDPOINT;
    patchAi({ aiEndpoint: stored });
    endpointInput.value = stored;
    resetTestState();
}

function commitApiKey() {
    patchAi({ aiApiKey: keyInput.value.trim() });
    resetTestState();
}

function commitModel() {
    const value = modelInput.value.trim();
    const stored = value || DEFAULT_AI_MODEL;
    patchAi({ aiModel: stored });
    modelInput.value = stored;
    resetTestState();
}

function toggleAiEnabled() {
    patchAi({ aiEnabled: !settings.value.ai.aiEnabled });
}

function toggleAiDriveReport() {
    patchAi({ aiDriveReport: !settings.value.ai.aiDriveReport });
}

function toggleAiInsights() {
    patchAi({ aiInsights: !settings.value.ai.aiInsights });
}

function toggleAiServiceNote() {
    patchAi({ aiServiceNote: !settings.value.ai.aiServiceNote });
}

// Session-cumulative token usage, for a sense of the running cost.
const usageLabel = computed(() => {
    const tokens = aiUsageTokens.value;
    if (tokens <= 0) return "";
    return tokens >= 1000
        ? `${(tokens / 1000).toFixed(1)}k`
        : String(tokens);
});

const voiceStyleItems = computed(() => [
    t("settings.aiVoiceTemplate"),
    t("settings.aiVoiceAi"),
]);
const currentVoiceStyleLabel = computed(() =>
    t(
        settings.value.ai.aiVoiceStyle === "ai"
            ? "settings.aiVoiceAi"
            : "settings.aiVoiceTemplate",
    ),
);

function updateVoiceStyle(label: string) {
    const index = voiceStyleItems.value.indexOf(label);
    if (index < 0) return;
    patchAi({
        aiVoiceStyle: AI_VOICE_STYLES[index] as AiVoiceStyle,
    });
}

// Connection probe: config edits invalidate a previous verdict.
type TestState = "idle" | "testing" | "ok" | "fail";
const testState = ref<TestState>("idle");
const testMessage = ref("");

const resetTestState = () => {
    if (testState.value !== "testing") testState.value = "idle";
};

async function runConnectionTest() {
    if (testState.value === "testing") return;

    const config = {
        endpoint: settings.value.ai.aiEndpoint,
        apiKey: settings.value.ai.aiApiKey,
        model: settings.value.ai.aiModel,
    };

    const missing = missingAiConfigFields(config);
    if (missing.length > 0) {
        testState.value = "fail";
        testMessage.value = t("settings.aiMissingFields", {
            fields: missing.map((field) => t(`settings.aiField.${field}`)).join(", "),
        });
        return;
    }

    testState.value = "testing";
    testMessage.value = "";

    const result = await testAiConnection(config);
    if (result.ok) {
        testState.value = "ok";
        testMessage.value = t("settings.aiTestOk", { model: config.model });
    } else {
        testState.value = "fail";
        const failure = result.failure;
        // "aborted" carries no message; the in-operator narrows it safely.
        const detail = "message" in failure ? failure.message : "";
        testMessage.value =
            failure.kind === "http"
                ? t("settings.aiTestHttp", {
                      status: failure.status,
                      message: failure.message,
                  })
                : t("settings.aiTestFail", { message: detail });
    }
}
</script>

<template>
    <div>
        <div class="option setting">
            <div class="option-title">
                <Icon name="lucide:sparkles" size="24" />
                <p>{{ t("settings.aiEnabled") }}</p>
            </div>

            <SegmentedControl
                :left-option="t('settings.on')"
                :right-option="t('settings.off')"
                @connect="toggleAiEnabled"
                size="normal"
                :active="hasAi"
            />
        </div>

        <template v-if="hasAi">
            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:layers" size="24" />
                    <p>{{ t("settings.aiProviderPreset") }}</p>
                </div>

                <USelect
                    :model-value="currentPresetLabel"
                    @update:model-value="(val: string) => applyPreset(val)"
                    :items="presetItems"
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
                    <Icon name="lucide:server" size="24" />
                    <p>{{ t("settings.aiEndpoint") }}</p>
                </div>

                <input
                    v-model="endpointInput"
                    type="text"
                    class="ai-input"
                    spellcheck="false"
                    autocapitalize="off"
                    autocomplete="off"
                    :placeholder="DEFAULT_AI_ENDPOINT"
                    @change="commitEndpoint"
                />
            </div>

            <p class="ai-hint">{{ t("settings.aiEndpointHint") }}</p>

            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:key-round" size="24" />
                    <p>{{ t("settings.aiApiKey") }}</p>
                </div>

                <input
                    v-model="keyInput"
                    type="password"
                    class="ai-input"
                    spellcheck="false"
                    autocapitalize="off"
                    autocomplete="off"
                    :placeholder="t('settings.aiApiKeyHint')"
                    @change="commitApiKey"
                />
            </div>

            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:cpu" size="24" />
                    <p>{{ t("settings.aiModel") }}</p>
                </div>

                <input
                    v-model="modelInput"
                    type="text"
                    class="ai-input"
                    spellcheck="false"
                    autocapitalize="off"
                    autocomplete="off"
                    :placeholder="DEFAULT_AI_MODEL"
                    @change="commitModel"
                />
            </div>

            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:plug-zap" size="24" />
                    <p>{{ t("settings.aiTestConnection") }}</p>
                </div>

                <button
                    type="button"
                    class="ai-test-btn"
                    :class="testState"
                    :disabled="testState === 'testing'"
                    @click="runConnectionTest"
                >
                    {{
                        testState === "testing"
                            ? t("settings.aiTesting")
                            : t("settings.aiTestConnection")
                    }}
                </button>
            </div>

            <p
                v-if="testState === 'ok' || testState === 'fail'"
                class="ai-test-result"
                :class="testState"
            >
                {{ testMessage }}
            </p>

            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:notebook-pen" size="24" />
                    <p>{{ t("settings.aiDriveReport") }}</p>
                </div>

                <SegmentedControl
                    :left-option="t('settings.on')"
                    :right-option="t('settings.off')"
                    @connect="toggleAiDriveReport"
                    size="normal"
                    :active="hasDriveReport"
                />
            </div>

            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:zap" size="24" />
                    <p>{{ t("settings.aiInsights") }}</p>
                </div>

                <SegmentedControl
                    :left-option="t('settings.on')"
                    :right-option="t('settings.off')"
                    @connect="toggleAiInsights"
                    size="normal"
                    :active="hasInsights"
                />
            </div>

            <div class="option setting" v-if="hasInsights">
                <div class="option-title">
                    <Icon name="lucide:heart-handshake" size="24" />
                    <p>{{ t("settings.aiServiceNote") }}</p>
                </div>

                <SegmentedControl
                    :left-option="t('settings.on')"
                    :right-option="t('settings.off')"
                    @connect="toggleAiServiceNote"
                    size="normal"
                    :active="hasServiceNote"
                />
            </div>

            <p v-if="hasInsights" class="ai-hint">
                {{ t("settings.aiServiceNoteHint") }}
            </p>

            <div class="option setting">
                <div class="option-title">
                    <Icon name="lucide:audio-lines" size="24" />
                    <p>{{ t("settings.aiVoiceStyle") }}</p>
                </div>

                <USelect
                    :model-value="currentVoiceStyleLabel"
                    @update:model-value="(val: string) => updateVoiceStyle(val)"
                    :items="voiceStyleItems"
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

            <p class="ai-hint">{{ t("settings.aiVoiceStyleHint") }}</p>

            <p v-if="usageLabel" class="ai-hint">
                {{ t("settings.aiUsage") }}: {{ usageLabel }}
            </p>
        </template>
    </div>
</template>

<style lang="scss" scoped>
.ai-input {
    min-width: 150px;
    max-width: 240px;

    background: $default-background-color-dark;
    border-radius: 5px;

    padding: 8px 10px;

    font-weight: 700;
    font-size: 1.6rem;
    color: $white-font-text;

    &::placeholder {
        font-weight: 500;
        opacity: 0.4;
    }
}

.ai-test-btn {
    min-width: 150px;

    background: $default-background-color-dark;
    border-radius: 5px;

    padding: 8px 10px;

    font-weight: 700;
    font-size: 1.6rem;
    color: $white-font-text;

    cursor: pointer;

    &.testing {
        opacity: 0.6;
        cursor: wait;
    }

    &.ok {
        color: #7ad48b;
    }

    &.fail {
        color: #f2635f;
    }
}

.ai-test-result {
    padding: 0 2rem;

    font-size: 1.4rem;
    font-weight: 500;
    line-height: 1.4;
    word-break: break-all;

    opacity: 0.85;

    &.ok {
        color: #7ad48b;
    }

    &.fail {
        color: #f2635f;
    }
}

.ai-hint {
    padding: 0 2rem;

    font-size: 1.4rem;
    font-weight: 500;
    line-height: 1.4;

    opacity: 0.5;
}
</style>
