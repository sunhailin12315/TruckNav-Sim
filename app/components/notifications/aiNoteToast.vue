<script lang="ts" setup>
// Toast for the one-shot AI notes (route insight, delivery recap, service
// reason). Purely presentational: it watches the note states in useAI and
// shows whichever turned "ready" last for a few seconds. Generation,
// gating and the voice path live in useAI / the map wiring. The service
// note is toast-only — unlike the other two it is never spoken, so the
// rest/fuel template cue keeps the audio channel to itself.

const { t } = useTranslations();
const { routeInsightState, deliveryNoteState, serviceNoteState } = useAI();

const SHOW_MS = 6000;

const isVisible = ref(false);
const titleKey = ref("aiNotes.routeInsight");
const note = ref("");

let timer: ReturnType<typeof setTimeout> | null = null;

function show(kind: "insight" | "delivery" | "service", text: string) {
    titleKey.value =
        kind === "insight"
            ? "aiNotes.routeInsight"
            : kind === "delivery"
              ? "aiNotes.deliveryNote"
              : "aiNotes.serviceNote";
    note.value = text;
    isVisible.value = true;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        isVisible.value = false;
    }, SHOW_MS);
}

watch(
    () => [routeInsightState.status, routeInsightState.note] as const,
    ([status, text]) => {
        if (status === "ready" && text) show("insight", text);
    },
);

watch(
    () => [deliveryNoteState.status, deliveryNoteState.note] as const,
    ([status, text]) => {
        if (status === "ready" && text) show("delivery", text);
    },
);

watch(
    () => [serviceNoteState.status, serviceNoteState.note] as const,
    ([status, text]) => {
        if (status === "ready" && text) show("service", text);
    },
);

onUnmounted(() => {
    if (timer) clearTimeout(timer);
});
</script>

<template>
    <Transition name="notification-slide">
        <div v-if="isVisible && note" class="ai-note-toast">
            <Icon name="lucide:sparkles" size="18" class="toast-icon" />
            <div class="toast-body">
                <span class="toast-title">{{ t(titleKey) }}</span>
                <span class="toast-note">{{ note }}</span>
            </div>
        </div>
    </Transition>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/navigation/aiNoteToast.scss"
></style>
