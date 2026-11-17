<script lang="ts" setup>
import { capitalize } from "vue";

const props = withDefaults(
    defineProps<{
        /**
         * Legacy inline note variant ("note" | "warning" | "caution").
         * Omit it for the compact click-to-open popup icon.
         */
        type?: "note" | "warning" | "caution";
        position?: "left" | "center" | "right";
    }>(),
    {
        position: "right",
    },
);

const popupOpened = ref(false);
</script>

<template>
    <div v-if="type" class="info-box note-box">
        <div class="title">
            <Icon name="lucide:info" class="icon" />
            <p>{{ capitalize(type) }}</p>
        </div>

        <slot name="content"></slot>
    </div>
    <div v-else class="info-box">
        <button
            type="button"
            class="icon-wrapper"
            @blur="popupOpened = false"
            @click="popupOpened = !popupOpened"
        >
            <Icon name="lucide:info" class="icon" />

            <AnimTransition type="pop">
                <div v-if="popupOpened" class="popup" :class="position">
                    <slot name="content"></slot>
                </div>
            </AnimTransition>
        </button>
    </div>
</template>

<style
    lang="scss"
    scoped
    src="~/assets/scss/scoped/common/infoBox.scss"
></style>
