import type { Messages } from "./en";

/**
 * Tamil instruction copy.
 *
 * Typed as `Messages` rather than inferred, so a key missing from this file —
 * or one that no longer exists in English — fails the build.
 *
 * REGISTER: this is spoken office Tamil, not written/literary Tamil. Staff
 * using this system already say "customer", "loan", "document", "upload",
 * "verify", "approve", "active" in English mid-sentence, and translating those
 * makes the copy *harder* to read, not easier — a clerk who sees
 * "வாடிக்கையாளர்" has to translate it back to "customer" to match what is on
 * the button next to it. So the domain nouns stay English and the connective
 * tissue is Tamil, which is exactly how the work is discussed out loud.
 *
 * Concretely:
 *   - Keep English: customer, loan, document, scheme, branch, ID, KYC, EMI,
 *     upload, verify, approve, active, reference, file
 *   - Translate: the verbs of instruction, the reasons, the connectives
 *   - Address the reader as "பண்ணுங்க", never "பண்ணவும்" (stiff) or
 *     "பண்ணு" (rude to a colleague)
 *   - Prefer the short spoken form: "இருக்கணும்" over "இருக்க வேண்டும்",
 *     "முடியாது" over "இயலாது"
 *
 * Do not "improve" this toward literary Tamil in review. It reads informal on
 * purpose. Anything here that sounds like a textbook is a bug.
 */
export const ta: Messages = {
  "loans.completeness.label.CUSTOMER_ACTIVE": "Customer active-ஆ இருக்காரா",
  "loans.completeness.label.SCHEME_ACTIVE": "Loan scheme இருக்கா",
  "loans.completeness.label.DURATION_SUPPORTED":
    "இந்த duration scheme-ல இருக்கா",
  "loans.completeness.label.AMOUNT_VALID": "Loan amount சரியா இருக்கா",
  "loans.completeness.label.PURPOSE_PRESENT": "Purpose போட்டாச்சா",
  "loans.completeness.label.RATE_VALID": "Interest rate அனுமதிச்சதா",
  "loans.completeness.label.GUARANTORS_READY": "Guarantor தயாரா இருக்காரா",
  "loans.completeness.label.DOCUMENTS_COMPLETE": "தேவையான documents இருக்கா",
  "loans.completeness.label.EMI_COMPUTES": "Repayment schedule கணக்கு வருதா",

  "loans.completeness.reason.CUSTOMER_NOT_ACTIVE":
    "இந்த customer active-ஆ இல்ல. முதல்ல activate பண்ணுங்க.",
  "loans.completeness.reason.SCHEME_NOT_FOUND":
    "தேர்ந்தெடுத்த scheme இப்ப இல்ல. வேற ஒன்ன select பண்ணுங்க.",
  "loans.completeness.reason.PRODUCT_INACTIVE":
    "இந்த loan product-ஐ நிறுத்திட்டாங்க. Active-ஆ இருக்குற product-ல ஒரு scheme எடுங்க.",
  "loans.completeness.reason.SCHEME_INACTIVE":
    "இந்த scheme-ஐ நிறுத்திட்டாங்க. புது application-க்கு இத use பண்ண முடியாது.",
  "loans.completeness.reason.TERM_NOT_OFFERED":
    "{count} {frequency} duration இந்த scheme-ல இல்ல. வேற duration select பண்ணுங்க.",
  "loans.completeness.reason.TERM_NOT_OFFERED_GENERIC":
    "நீங்க select பண்ணின duration இந்த scheme-ல இல்ல.",
  "loans.completeness.reason.AMOUNT_NOT_POSITIVE":
    "Loan amount 0-க்கு மேல இருக்கணும்.",
  "loans.completeness.reason.PURPOSE_MISSING": "இந்த loan எதுக்குனு போடுங்க.",
  "loans.completeness.reason.RATE_NEGATIVE":
    "Interest rate minus-ல இருக்க முடியாது.",
  "loans.completeness.reason.RATE_DIFFERS_FROM_SCHEME":
    "இந்த rate scheme rate-ல இருந்து வேறுபடுது. Custom Rate type use பண்ணுங்க — அதுக்கு தனி permission வேணும்.",
  "loans.completeness.reason.GUARANTOR_NOT_READY":
    "Guarantor active-ஆ இல்ல, இல்லன்னா consent கொடுக்கல, இல்லன்னா KYC முடியல.",
  "loans.completeness.reason.DOCUMENTS_MISSING": "இன்னும் வேணும்: {missing}.",
  "loans.completeness.reason.DOCUMENTS_MISSING_GENERIC":
    "தேவையான documents இல்ல.",
  "loans.completeness.reason.UNKNOWN_WITH_CODE": "இது pass ஆகல ({reason}).",
  "loans.completeness.reason.UNKNOWN": "இது pass ஆகல.",

  "loans.completeness.notReady": "தயாரா இல்ல",
  "loans.completeness.readyToSubmit": "Submit பண்ண தயார்",
  "loans.completeness.blocked":
    "எல்லா check-ம் pass ஆகுற வரைக்கும் submit பண்ண முடியாது. நீங்க submit பண்ணும்போது server எல்லாத்தையும் மறுபடியும் check பண்ணும், அதனால இடையில scheme நிறுத்திட்டாலும் அது தெரிஞ்சுடும்.",
  "loans.completeness.sr.passed": " — pass ஆயிடுச்சு",
  "loans.completeness.sr.notPassed": " — pass ஆகல",

  "loans.sanction.termsFixed":
    "Approve பண்ணின terms அப்படியே letter-ல வரும். இங்க அத மாத்த முடியாது.",
  "loans.sanction.declineIsFinal":
    "Decline பதிவு பண்ணா application reject ஆயிடும். நீங்க கொடுக்குற காரணமே reject காரணமா இருக்கும்.",
  "loans.sanction.responsePrompt":
    "Sanction letter கொடுத்தாச்சு. Customer என்ன சொன்னாருனு பதிவு பண்ணுங்க: ஏத்துக்கிட்டா agreement sign பண்ற step-க்கு போவாங்க, மறுத்தா application நிரந்தரமா reject ஆயிடும்.",
  "loans.sanction.agreementIsARecord":
    "Customer paper agreement-ல sign பண்ணின பிறகு மட்டும் இத பதிவு பண்ணுங்க. இங்க எதுவும் generate ஆகல, sign-ம் ஆகல — அது நடந்துச்சுனு நீங்க பதிவு பண்றீங்க, அவ்ளோ தான். Loan disburse பண்றதுக்கு முந்தின கடைசி step இது.",
  "loans.sanction.validUntilHint":
    "வேணும்னா போடுங்க. Letter-ல பதிவாகும், ஆனா கட்டாயம் இல்ல.",
  "loans.sanction.signedDateHint":
    "வேணும்னா போடுங்க. போடலன்னா இன்னைக்கு date போயிடும்.",
  "loans.sanction.agreementReferenceHint":
    "வேணும்னா போடுங்க. Sign பண்ணின paper agreement-க்கு உங்க file number — உ.ம். AGR-000001 இல்லன்னா stamp paper number.",
};
