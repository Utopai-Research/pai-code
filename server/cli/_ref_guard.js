// Guard: reject prompts that NAME refs they didn't WIRE.
// Modification notice: validate named video refs against resolved media types.
//
// @ImageN / @VideoN / @AudioN in a prompt are positional labels for the refs
// passed via flags (--ref-source-id for image+video sources,
// --ref-audio-source-id for audio) — "positional by flag order", per
// skills/video-compose/SKILL.md. They are NOT parsed into refs: an agent can
// write "@Image1" and forget the flag, and nothing stops the model from
// improvising the environment, the face identity, and the voice. (That is
// exactly what produced a broken clip once: the prompt named
// @Image1/@Image2/@Audio1 but passed zero flags, so none of the canvas refs
// reached the model. curl/ffprobe/AI-judges all "passed" it; only the node
// metadata + a human ear caught it.)
//
// This guard is called by every generate CLI BEFORE staging and BEFORE any
// paid call, so a single implementation covers all agents (Claude, Codex,
// future /goal runs) and manual/script CLI use.
//
// IMPORTANT — it checks MAX INDEX per kind, never mention COUNT. One ref may be
// referenced many times in a prompt: "@Image1 ... @Image1 ... @Image1" with a
// single image ref is legitimate. The invariant is that the highest ordinal
// referenced for a kind has a matching ref; repeated mentions of the same
// ordinal must pass.

// Case-sensitive — mirrors the renderer (`@image1` is not a token; it
// lowercases only AFTER matching `Image|Video|Audio`). The trailing `(?![\w])`
// is load-bearing: it stops prose from being mis-read as a ref —
// `@Image2K` (that is literally the --image-size vocabulary), `@Audio48khz`,
// `@Image1Studios` (a handle in dialogue) must NOT match. Ordinal is 1-based.
const REF_MENTION_RE = /@(Image|Video|Audio)([1-9]\d*)(?![\w])/g;

// Highest ordinal referenced per kind: { Image, Video, Audio } (0 = none).
function maxMentionedOrdinals(prompt) {
  const max = { Image: 0, Video: 0, Audio: 0 };
  for (const m of String(prompt ?? "").matchAll(REF_MENTION_RE)) {
    const n = Number(m[2]);
    if (n > max[m[1]]) max[m[1]] = n;
  }
  return max;
}

// Validate that a prompt's @-mentions have matching ref flags. Returns a
// bad_args message string on violation, or null when wired correctly.
//
//   tier "image"  — generate_image[_pro]: only --ref-source-id image refs
//     exist. @Image must be backed by a ref; @Video/@Audio are category errors
//     (no flag on this tier could ever satisfy them).
//   tier "video" — --ref-source-id carries image AND video refs, with separate
//     ordinal sequences. generate_video resolves their types before staging
//     and supplies imageRefCount/videoRefCount, so an image cannot stand in
//     for a missing @VideoN (or vice versa). Callers without resolved counts
//     retain the combined-count precheck. @Audio uses its dedicated flag count.
export function checkPromptRefsWired({
  prompt, refSourceCount = 0, imageRefCount, videoRefCount, audioRefCount = 0, tier,
}) {
  const max = maxMentionedOrdinals(prompt);

  if (tier === "image") {
    if (max.Video > 0 || max.Audio > 0) {
      const bad = max.Video > 0 ? `@Video${max.Video}` : `@Audio${max.Audio}`;
      return `prompt references ${bad}, but the image tier supports only image refs (--ref-source-id). Remove the mention, or use generate_video.js for video/audio refs.`;
    }
    if (max.Image > refSourceCount) {
      return `prompt references @Image${max.Image} but only ${refSourceCount} image ref(s) passed via --ref-source-id. Pass the missing ref(s), or fix the mention. (Mentioning the same @ImageN repeatedly is fine — only the highest index needs a matching ref.)`;
    }
    return null;
  }

  if (tier === "video") {
    if (max.Audio > audioRefCount) {
      return `prompt references @Audio${max.Audio} but only ${audioRefCount} audio ref(s) passed via --ref-audio-source-id. Pass the missing ref(s), or remove the mention.`;
    }
    if (imageRefCount !== undefined && videoRefCount !== undefined) {
      if (max.Image > imageRefCount) {
        return `prompt references @Image${max.Image} but only ${imageRefCount} image ref(s) passed via --ref-source-id. Video refs do not fill image slots. Pass the missing image ref(s), or fix the mention.`;
      }
      if (max.Video > videoRefCount) {
        return `prompt references @Video${max.Video} but only ${videoRefCount} video ref(s) passed via --ref-source-id. Image refs do not fill video slots. Pass the missing video ref(s), or fix the mention.`;
      }
      return null;
    }
    const sourceNeeded = max.Image + max.Video;
    if (sourceNeeded > refSourceCount) {
      const parts = [];
      if (max.Image) parts.push(`@Image${max.Image}`);
      if (max.Video) parts.push(`@Video${max.Video}`);
      return `prompt references ${parts.join(" + ")} (needs ${sourceNeeded} source ref(s)) but only ${refSourceCount} passed via --ref-source-id. Pass the missing ref(s), or fix the mention.`;
    }
    return null;
  }

  return null;
}
