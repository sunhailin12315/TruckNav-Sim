// Cue-text pronunciation fixes for the neural TTS engines (cloud Edge
// voice and the offline sherpa model). Both are end-to-end models that
// guess polyphones from context and stumble on place names the training
// data barely covers — navigation cues are exactly that kind of text.
// The fixes are homophone substitutions: "单县" is rewritten to "善县" so
// the model reads shàn instead of the default dān. The screen text is
// never touched; only the string handed to the synthesizer changes.
//
// The OS speech path is deliberately NOT processed — system engines use
// proper dictionaries and usually read these names right, and a wrong
// homophone there would degrade correct speech.
//
// Keep the table small and curated: every entry needs a confirmed
// misread. Longest keys first so a compound beats its shorter prefix.
const ZH_FIXES: readonly (readonly [string, string])[] = [
    // Chinese polyphones frequent in route place names.
    ["单县", "善县"],
    ["单州", "善州"],
    ["六安", "陆安"],
    ["蚌埠", "蹦埠"],
    ["亳州", "博州"],
    ["蔚县", "玉县"],
    ["乐亭", "劳亭"],
    ["繁峙", "凡治"],
    ["郓城", "运城"],
    ["砀山", "荡山"],
    ["长汀", "常汀"],
    ["匝道", "扎道"],
    // Words both engines routinely misread in driving context.
    ["调头", "掉头"],
];

const SORTED_FIXES = [...ZH_FIXES].sort(
    (a, b) => b[0].length - a[0].length,
);

/**
 * Rewrites cue text into a phonetically equivalent form for the neural
 * engines. Idempotent and identity for locales without a fix table.
 */
export function applyPronunciationFixes(
    text: string,
    locale: string,
): string {
    if (locale !== "zh" || text.length === 0) return text;
    let fixed = text;
    for (const [from, to] of SORTED_FIXES) {
        if (fixed.includes(from)) {
            fixed = fixed.split(from).join(to);
        }
    }
    return fixed;
}
