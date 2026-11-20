package com.nexus.eva

/**
 * Pure Kotlin wake-word matcher mirroring Nexus Eva's web wake matcher.
 * Recognizes "Hey Eva", "Eva", "Evay", "Hey Evay", phonetic ASR variants, and custom wake phrases
 * while enforcing strict word-boundary guards against substring false positives
 * (e.g. "whatever", "medieval", "evaluate", "elevator").
 */
object WakePhraseMatcher {

    const val DEFAULT_WAKE_PHRASE = "Hey Eva"

    data class MatchResult(
        val matched: Boolean,
        val matchedPhrase: String = "",
        val trailingCommand: String = "",
    )

    private val DEFAULT_HEY_EVA_VARIANTS = listOf(
        "hey eva",
        "hey evay",
        "hey eeva",
        "hey evah",
        "hey ava",
        "hey avah",
        "hey aiva",
        "hey eiva",
        "hey iva",
        "hey eba",
        "hey ewa",
        "hey ever",
        "hey evo",
        "hay eva",
        "hay evay",
        "hi eva",
        "hi evay",
        "hi ava",
        "ok eva",
        "okay eva",
        "ok ava",
        "okay ava",
        "hello eva",
        "yo eva",
        "eva please",
    )

    private val DIRECT_EVA_VARIANTS = listOf(
        "eva",
        "evay",
        "eeva",
        "evah",
        "ava",
        "avah",
        "aiva",
        "eiva",
        "iva",
        "ivah",
        "eba",
        "ewa",
        "eeba",
        "heva",
        "ifa",
        "e v a",
    )

    private val NON_ALNUM_REGEX = Regex("[^a-z0-9\\s]+")
    private val MULTI_SPACE_REGEX = Regex("\\s+")
    private val LEADING_PUNCT_REGEX = Regex("^[\\s,.:;!?\\-]+")

    fun normalize(text: String): String {
        return text
            .lowercase()
            .replace(NON_ALNUM_REGEX, " ")
            .replace(MULTI_SPACE_REGEX, " ")
            .trim()
    }

    fun match(transcript: String, wakePhrase: String = DEFAULT_WAKE_PHRASE): MatchResult {
        val clean = transcript.trim()
        if (clean.isEmpty()) return MatchResult(matched = false)

        val normTranscript = normalize(clean)
        if (normTranscript.isEmpty()) return MatchResult(matched = false)

        val normTarget = normalize(wakePhrase.ifBlank { DEFAULT_WAKE_PHRASE })
        val isDefaultProfile = normTarget == "hey eva" || normTarget == "eva" || normTarget == "evay"

        val candidates = if (isDefaultProfile) {
            DEFAULT_HEY_EVA_VARIANTS + DIRECT_EVA_VARIANTS
        } else {
            listOf(normTarget)
        }

        // Check longer phrases first so "hey eva check tasks" captures "hey eva" over bare "eva"
        val sortedCandidates = candidates.distinct().sortedByDescending { it.length }

        for (candidate in sortedCandidates) {
            val idx = findWholeWordPhraseIndex(normTranscript, candidate)
            if (idx >= 0) {
                val afterNorm = normTranscript.substring(idx + candidate.length).trim()
                val trailing = extractOriginalTrailing(clean, afterNorm)
                return MatchResult(
                    matched = true,
                    matchedPhrase = candidate,
                    trailingCommand = trailing,
                )
            }
        }

        return MatchResult(matched = false)
    }

    fun matchCandidates(transcripts: List<String>, wakePhrase: String = DEFAULT_WAKE_PHRASE): MatchResult {
        var best: MatchResult? = null
        for (raw in transcripts) {
            val res = match(raw, wakePhrase)
            if (res.matched) {
                if (best == null) {
                    best = res
                } else {
                    val betterTrailing = res.trailingCommand.length > best.trailingCommand.length
                    val sameTrailingLongerPhrase =
                        res.trailingCommand.length == best.trailingCommand.length &&
                            res.matchedPhrase.length > best.matchedPhrase.length
                    if (betterTrailing || sameTrailingLongerPhrase) {
                        best = res
                    }
                }
            }
        }
        return best ?: MatchResult(matched = false)
    }

    private fun findWholeWordPhraseIndex(haystack: String, needle: String): Int {
        if (needle.isEmpty()) return -1
        var searchFrom = 0
        while (searchFrom <= haystack.length - needle.length) {
            val idx = haystack.indexOf(needle, startIndex = searchFrom)
            if (idx < 0) return -1
            val beforeOk = idx == 0 || haystack[idx - 1] == ' '
            val end = idx + needle.length
            val afterOk = end == haystack.length || haystack[end] == ' '
            if (beforeOk && afterOk) return idx
            searchFrom = idx + 1
        }
        return -1
    }

    private fun extractOriginalTrailing(original: String, normalizedTrailing: String): String {
        if (normalizedTrailing.isEmpty()) return ""
        val words = normalizedTrailing.split(" ").filter { it.isNotBlank() }
        if (words.isEmpty()) return ""
        val firstWord = Regex.escape(words.first())
        val regex = Regex("\\b$firstWord\\b", RegexOption.IGNORE_CASE)
        val match = regex.find(original) ?: return normalizedTrailing
        return original.substring(match.range.first).replace(LEADING_PUNCT_REGEX, "").trim()
    }
}
