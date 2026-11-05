import type { LanguageFn } from "highlight.js";

// Small, deliberately incomplete grammars for languages not provided by highlight.js.
// The picker identifies these as approximate; imported source is never rewritten.
export const abap: LanguageFn = (hljs) => ({
  name: "ABAP (approximate)",
  case_insensitive: true,
  keywords: {
    keyword:
      "DATA TYPES CONSTANTS FIELD-SYMBOLS CLASS ENDCLASS METHOD ENDMETHOD FORM ENDFORM IF ELSE ELSEIF ENDIF CASE WHEN ENDCASE LOOP ENDLOOP DO ENDDO WHILE ENDWHILE SELECT FROM WHERE INTO ENDSELECT INSERT UPDATE DELETE MODIFY READ TABLE WITH KEY APPEND CLEAR WRITE RETURN CALL FUNCTION IMPORTING EXPORTING CHANGING TRY CATCH ENDTRY RAISE EXCEPTION REPORT PROGRAM INCLUDE",
    literal: "abap_true abap_false space",
  },
  contains: [
    hljs.COMMENT('"', "$"),
    hljs.COMMENT("^\\*", "$"),
    { scope: "string", begin: "'", end: "'", contains: [{ begin: "''" }] },
    { scope: "string", begin: "`", end: "`" },
    hljs.NUMBER_MODE,
  ],
});

export const cypher: LanguageFn = (hljs) => ({
  name: "Cypher (approximate)",
  case_insensitive: true,
  keywords: {
    keyword:
      "MATCH OPTIONAL WHERE RETURN WITH AS ORDER BY SKIP LIMIT CREATE MERGE ON SET REMOVE DELETE DETACH UNWIND UNION ALL DISTINCT CALL YIELD AND OR XOR NOT IN IS NULL STARTS ENDS CONTAINS CASE WHEN THEN ELSE END EXISTS FOREACH",
    literal: "true false null",
  },
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    { scope: "variable", begin: /\$[A-Za-z_][\w]*/ },
    { scope: "symbol", begin: /:[A-Za-z_][\w]*/ },
    hljs.NUMBER_MODE,
  ],
});

export const git: LanguageFn = (hljs) => ({
  name: "Git (approximate)",
  contains: [
    hljs.HASH_COMMENT_MODE,
    { scope: "meta", begin: /^\s*\$\s*/ },
    { scope: "keyword", begin: /\bgit\b/ },
    {
      scope: "built_in",
      begin:
        /\b(?:add|branch|checkout|cherry-pick|clone|commit|diff|fetch|init|log|merge|pull|push|rebase|remote|reset|restore|revert|show|stash|status|switch|tag)\b/,
    },
    { scope: "literal", begin: /\B--?[\w][\w-]*/ },
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
  ],
});

export const solidity: LanguageFn = (hljs) => ({
  name: "Solidity (approximate)",
  keywords: {
    keyword:
      "pragma solidity import as from contract interface library abstract is using for struct enum mapping function constructor modifier event error returns return if else while do break continue revert require assert emit try catch throw new delete public private internal external pure view payable virtual override immutable constant memory storage calldata indexed anonymous unchecked assembly fallback receive let switch case default leave",
    type: "address bool string bytes byte uint int fixed ufixed var",
    literal: "true false",
    built_in:
      "msg block tx abi this super type gasleft keccak256 sha256 ripemd160 ecrecover addmod mulmod selfdestruct",
  },
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.C_NUMBER_MODE,
    { scope: "type", begin: /\b(?:u?int(?:8|16|24|32|64|128|160|256)?|bytes(?:[1-9]|[12]\d|3[0-2]))\b/ },
  ],
});

export const velocity: LanguageFn = (hljs) => ({
  name: "Velocity (approximate)",
  contains: [
    hljs.COMMENT("##", "$"),
    hljs.COMMENT("#\\*", "\\*#"),
    { scope: "keyword", begin: /#(?:if|elseif|else|end|foreach|set|macro|parse|include|evaluate|stop|break|define)\b/ },
    { scope: "variable", begin: /\$!?\{?[A-Za-z_][\w.]*(?:\})?/ },
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.NUMBER_MODE,
  ],
});
