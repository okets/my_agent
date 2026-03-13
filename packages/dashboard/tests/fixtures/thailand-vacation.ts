/**
 * Synthetic test data: Thailand Vacation
 *
 * Follows the M6.6 spec test narrative. All dates use offsets from Date.now()
 * to prevent tests from breaking due to dates being in the past.
 */

function formatDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().split("T")[0];
}

// --- Input densities for testing ---

/**
 * Rich input: full reference files + daily logs + knowledge
 * Tests the "normal day" scenario with plenty of context
 */
export const RICH_INPUT = {
  reference: {
    "contacts.md": `# Contacts

## Hanan (Owner)
- Relationship: Owner / CTO
- Location: Chiang Mai, Thailand (traveling)
- Phone: +1555000000
- Preferences: Direct communication, no fluff

## Kai
- Relationship: Local guide (Chiang Mai)
- Context: Temple tour guide, met via hotel concierge
- Phone: +66-example-000
`,
    "preferences.md": `# Preferences

- Communication: Direct, concise
- Food: Loves pad krapao, spicy food in general
- Travel: Prefers local experiences over tourist traps
- Work: Morning person, prefers async communication after noon
`,
    "standing-orders.md": `# Standing Orders

- Always check calendar before scheduling anything
- Notify immediately for messages from Hanan
- Use Hebrew for personal conversations with Hanan
`,
  },
  daily: {
    yesterday: `# Daily Log — ${isoDate(-1)}

## Activity
- 09:00 — Hanan messaged about temple tour plans
- 10:30 — Researched Doi Suthep temple visiting hours
- 14:00 — Hanan confirmed meeting Kai at hotel lobby at 8am tomorrow
- 16:00 — Hanan asked about restaurant recommendations near Tha Phae Gate
- 16:15 — Found pad krapao place with 4.8 rating, sent details

## Notes
- Hanan mentioned flying to Krabi on ${formatDate(4)}, back to Tel Aviv on ${formatDate(9)}
- Hotel checkout is at noon on ${formatDate(4)}
`,
  },
  knowledge: {
    "facts.md": `# Facts

- Hanan is currently in Chiang Mai, Thailand (arrived ${formatDate(-2)})
- Flying to Krabi on ${formatDate(4)}
- Return flight to Tel Aviv on ${formatDate(9)}
- Hotel: Akyra Manor (until ${formatDate(4)})
- Temple tour with Kai scheduled for tomorrow at 8am
`,
    "people.md": `# People

## Kai
- Local guide in Chiang Mai
- Specializes in temple tours
- Recommended by hotel concierge
- Meeting point: hotel lobby
`,
    "preferences.md": `# Learned Preferences

- Found amazing pad krapao place near Tha Phae Gate
- Prefers walking over tuk-tuks for short distances
- Likes to have morning coffee before activities
`,
  },
};

/**
 * Sparse input: minimal data — just arrived, barely any context
 * Tests graceful handling of limited information
 */
export const SPARSE_INPUT = {
  reference: {
    "contacts.md": `# Contacts

## Hanan (Owner)
- Relationship: Owner / CTO
- Phone: +1555000000
`,
  },
  daily: {
    yesterday: `# Daily Log — ${isoDate(-1)}

## Activity
- 15:00 — Hanan said "I just landed in Chiang Mai"
`,
  },
  knowledge: {},
};

/**
 * Empty input: no notebook data at all
 * Tests cold start — scheduler runs but nothing is populated yet
 */
export const EMPTY_INPUT = {
  reference: {},
  daily: {},
  knowledge: {},
};

/**
 * Conflicting input: reference says one thing, knowledge says another
 * Tests whether the model resolves conflicts correctly
 */
export const CONFLICTING_INPUT = {
  reference: {
    "contacts.md": `# Contacts

## Hanan (Owner)
- Relationship: Owner / CTO
- Location: Tel Aviv, Israel
- Phone: +1555000000
`,
  },
  daily: {
    yesterday: `# Daily Log — ${isoDate(-1)}

## Activity
- 09:00 — Hanan messaged: "Just landed in Chiang Mai!"
- 09:30 — Hanan asked about local SIM cards
- 14:00 — Hanan said he'll be here for a week, then Krabi
`,
  },
  knowledge: {
    "facts.md": `# Facts

- Hanan is currently in Chiang Mai, Thailand (arrived today)
- Previous location: Tel Aviv
- Planning to visit Krabi after Chiang Mai
`,
  },
};

/**
 * Verbose input: long daily logs with lots of noise
 * Tests whether the model extracts signal from noise and stays within budget
 */
export const VERBOSE_INPUT = {
  reference: {
    "contacts.md": RICH_INPUT.reference["contacts.md"],
    "preferences.md": RICH_INPUT.reference["preferences.md"],
    "standing-orders.md": RICH_INPUT.reference["standing-orders.md"],
  },
  daily: {
    yesterday: `# Daily Log — ${isoDate(-1)}

## Activity
- 06:30 — System startup, all plugins healthy
- 06:31 — Memory index sync completed (342 chunks)
- 06:32 — Calendar sync: 3 events today
- 07:00 — Morning prep completed
- 07:15 — WhatsApp connected, session restored
- 08:00 — Hanan sent photo of hotel breakfast spread
- 08:05 — Hanan asked "what's the weather like today?"
- 08:06 — Checked weather API: 32°C, partly cloudy, humidity 78%
- 08:10 — Hanan said "perfect for temple visit"
- 08:30 — Hanan asked about Doi Suthep opening hours
- 08:31 — Searched: Wat Phra That Doi Suthep opens 6am-6pm daily, 30 baht entry
- 08:35 — Hanan asked about dress code for temples
- 08:36 — Responded: long pants, covered shoulders required. Can rent sarongs at entrance.
- 09:00 — Hanan went offline
- 09:15 — Abbreviated conversation (12 turns)
- 10:00 — Calendar reminder: "Call dentist" — Hanan marked as snoozed
- 10:30 — System health check: all green
- 11:00 — Hanan messaged: "At Doi Suthep now, incredible views"
- 11:05 — Hanan sent 3 photos of temple
- 11:10 — Hanan asked about the history of the temple
- 11:15 — Researched and sent summary of Doi Suthep history (founded 1383)
- 12:00 — Hanan: "heading back, where should I eat lunch?"
- 12:05 — Searched for restaurants near Old City
- 12:10 — Recommended: Khao Soi Khun Yai (famous khao soi), Cherng Doi Roast Chicken
- 12:15 — Hanan chose Khao Soi Khun Yai
- 13:00 — Hanan: "khao soi is amazing, almost as good as the pad krapao yesterday"
- 13:30 — Hanan went offline
- 13:35 — Abbreviated conversation (8 turns)
- 14:00 — Calendar: flight to Krabi on ${formatDate(4)} (4 days away)
- 14:30 — Task completed: "Research Krabi beaches" — top 3: Railay, Ao Nang, Klong Muang
- 15:00 — Hanan messaged: "Can you book a longtail boat tour in Krabi?"
- 15:05 — Searched local tour operators, found 3 options
- 15:10 — Sent comparison table (price, duration, reviews)
- 15:15 — Hanan: "book the 4-island tour, the one with good reviews"
- 15:20 — Created task: "Book 4-island longtail boat tour in Krabi"
- 16:00 — Hanan asked about evening plans
- 16:05 — Suggested: Night Bazaar (walking distance), Sunday Walking Street (if weekend)
- 16:10 — Hanan: "Night Bazaar sounds good, see you later"
- 16:15 — Hanan went offline
- 16:20 — Abbreviated conversation (6 turns)
- 18:00 — System health check: all green
- 20:00 — Hanan: "Night Bazaar was fun, bought some souvenirs"
- 20:05 — Hanan: "Early morning tomorrow, meeting Kai at 8am for temple tour"
- 20:10 — Set reminder: 7:00 tomorrow "Temple tour with Kai — meet at hotel lobby"
- 20:15 — Hanan: "good night"
- 20:20 — Abbreviated conversation (4 turns)
- 23:00 — Daily summary completed

## Notes
- Hanan visited Doi Suthep, enjoyed khao soi at Khun Yai
- Krabi boat tour needs booking (task created)
- Temple tour with Kai tomorrow at 8am
- Dentist call snoozed (reschedule?)
- Hanan particularly enjoyed pad krapao yesterday and khao soi today
`,
  },
  knowledge: RICH_INPUT.knowledge,
};

/**
 * Mixed language input: Hebrew + English (realistic for this agent)
 */
export const MIXED_LANGUAGE_INPUT = {
  reference: {
    "contacts.md": `# Contacts

## Hanan (Owner)
- Relationship: Owner / CTO
- Location: Chiang Mai, Thailand
- Phone: +1555000000
- Language: Hebrew (personal), English (work)
`,
  },
  daily: {
    yesterday: `# Daily Log — ${isoDate(-1)}

## Activity
- 09:00 — Hanan: "בוקר טוב! מה התוכניות להיום?"
- 09:05 — Discussed temple tour plans in Hebrew
- 10:00 — Hanan switched to English: "Can you research the best pad thai in Chiang Mai?"
- 14:00 — Hanan: "הסיור במקדש היה מדהים, קאי מדריך מעולה"
- 14:05 — Translation context: temple tour was amazing, Kai is an excellent guide
`,
  },
  knowledge: {
    "facts.md": `# Facts

- Hanan is in Chiang Mai, Thailand
- Prefers Hebrew for personal conversations
- Temple tour with Kai was completed and enjoyed
`,
  },
};

/**
 * Full Hebrew input: realistic scenario where notebook content is in Hebrew
 * Tests whether Haiku can extract facts and produce English output
 */
export const FULL_HEBREW_INPUT = {
  reference: {
    "contacts.md": `# אנשי קשר

## חנן (בעלים)
- יחס: בעלים / CTO
- מיקום: צ'יאנג מאי, תאילנד (בחופשה)
- טלפון: +1555000000
- העדפות: תקשורת ישירה, בלי מילים מיותרות

## קאי
- יחס: מדריך מקומי (צ'יאנג מאי)
- הקשר: מדריך סיורי מקדשים, הגיע דרך הקונסיירז' של המלון
`,
    "preferences.md": `# העדפות

- תקשורת: ישירה, תמציתית
- אוכל: אוהב פאד קראפאו, אוכל חריף באופן כללי
- טיולים: מעדיף חוויות מקומיות על פני מלכודות תיירים
- עבודה: אדם של בוקר, מעדיף תקשורת אסינכרונית אחרי הצהריים
`,
  },
  daily: {
    yesterday: `# יומן — ${isoDate(-1)}

## פעילות
- 09:00 — חנן שלח הודעה על תוכניות הסיור במקדש
- 10:30 — חקרתי שעות ביקור בדוי סוטהפ
- 14:00 — חנן אישר פגישה עם קאי בלובי המלון ב-8 בבוקר מחר
- 16:00 — חנן שאל על המלצות למסעדות ליד שער טה פאה
- 16:15 — מצאתי מקום פאד קראפאו עם דירוג 4.8, שלחתי פרטים

## הערות
- חנן הזכיר טיסה לקראבי ב-${formatDate(4)}, חזרה לתל אביב ב-${formatDate(9)}
- צ'ק אאוט מהמלון בצהריים ב-${formatDate(4)}
`,
  },
  knowledge: {
    "facts.md": `# עובדות

- חנן נמצא כרגע בצ'יאנג מאי, תאילנד (הגיע ב-${formatDate(-2)})
- טס לקראבי ב-${formatDate(4)}
- טיסת חזרה לתל אביב ב-${formatDate(9)}
- מלון: אקירה מנור (עד ${formatDate(4)})
- סיור מקדשים עם קאי מתוכנן למחר ב-8 בבוקר
`,
    "people.md": `# אנשים

## קאי
- מדריך מקומי בצ'יאנג מאי
- מתמחה בסיורי מקדשים
- הומלץ על ידי קונסיירז' המלון
- נקודת מפגש: לובי המלון
`,
  },
};

export const HEBREW_CONVERSATION_ABBREVIATIONS = [
  {
    title: "תכנון סיור מקדשים",
    abbreviation: `חנן דיבר על תוכניות הסיור במקדש למחר. אישר פגישה עם קאי (מדריך מקומי) בלובי המלון ב-8 בבוקר. חקרתי שעות ביקור בדוי סוטהפ (6 בבוקר עד 6 בערב, 30 באט). קוד לבוש: מכנסיים ארוכים, כתפיים מכוסות.`,
  },
  {
    title: "חיפוש מסעדות",
    abbreviation: `חנן שאל על המלצות לארוחת צהריים ליד העיר העתיקה. הצעתי קאו סוי קון יאי וצ'רנג דוי עוף צלוי. חנן בחר את מקום הקאו סוי, אחר כך דיווח שזה היה "מדהים, כמעט טוב כמו הפאד קראפאו אתמול." גם דיברנו על אפשרויות סיור סירות בקראבי.`,
  },
];

// --- Structured conversation data for E2E memory lifecycle tests (M6.6-S4) ---

export const THAILAND_CONVERSATIONS = [
  {
    id: "conv-thailand-001",
    title: "Chiang Mai Arrival",
    turns: [
      {
        role: "user" as const,
        content: "I just landed in Chiang Mai!",
        timestamp: isoDate(-2),
        turnNumber: 1,
      },
      {
        role: "assistant" as const,
        content:
          "Welcome to Chiang Mai! The old city area is beautiful. How was your flight?",
        timestamp: isoDate(-2),
        turnNumber: 1,
      },
      {
        role: "user" as const,
        content: "Found an amazing pad krapao place near Tha Phae Gate",
        timestamp: isoDate(-2),
        turnNumber: 2,
      },
      {
        role: "assistant" as const,
        content:
          "Tha Phae Gate area has incredible street food. Pad krapao is such a classic!",
        timestamp: isoDate(-2),
        turnNumber: 2,
      },
      {
        role: "user" as const,
        content: "Meeting a local guide named Kai tomorrow for a temple tour",
        timestamp: isoDate(-1),
        turnNumber: 3,
      },
      {
        role: "assistant" as const,
        content:
          "Temple tours are the best way to experience Chiang Mai. Enjoy it!",
        timestamp: isoDate(-1),
        turnNumber: 3,
      },
      {
        role: "user" as const,
        content: `Flying to Krabi on ${formatDate(4)}, back to Tel Aviv on ${formatDate(9)}`,
        timestamp: isoDate(-1),
        turnNumber: 4,
      },
      {
        role: "assistant" as const,
        content: "Great itinerary! Krabi has amazing beaches. Safe travels!",
        timestamp: isoDate(-1),
        turnNumber: 4,
      },
    ],
  },
];

/**
 * Build transcript text from turns (same format as AbbreviationQueue)
 */
export function buildTranscript(
  turns: (typeof THAILAND_CONVERSATIONS)[0]["turns"],
): string {
  return turns
    .map((turn) => {
      const role = turn.role === "user" ? "User" : "Assistant";
      return `${role}: ${turn.content}`;
    })
    .join("\n\n");
}

/**
 * Expected facts that should be extracted from the Thailand conversations
 */
export const EXPECTED_FACTS = {
  locations: ["Chiang Mai", "Krabi", "Tel Aviv"],
  people: ["Kai"],
  preferences: ["pad krapao"],
  schedule: ["Tha Phae Gate", "temple tour"],
};

// --- Conversation transcripts for daily summary testing ---

export const RICH_CONVERSATION_ABBREVIATIONS = [
  {
    title: "Temple Tour Planning",
    abbreviation: `Hanan discussed temple tour plans for tomorrow. Confirmed meeting Kai (local guide) at hotel lobby at 8am. Researched Doi Suthep visiting hours (6am-6pm, 30 baht). Dress code: long pants, covered shoulders. Hanan is excited about the visit.`,
  },
  {
    title: "Restaurant Hunt",
    abbreviation: `Hanan asked for lunch recommendations near Old City. Suggested Khao Soi Khun Yai and Cherng Doi Roast Chicken. Hanan chose khao soi place, later reported it was "amazing, almost as good as the pad krapao yesterday." Also discussed Krabi boat tour options — Hanan wants the 4-island tour booked.`,
  },
  {
    title: "Evening Plans",
    abbreviation: `Hanan asked about evening activities. Suggested Night Bazaar and Sunday Walking Street. Went to Night Bazaar, bought souvenirs. Confirmed early morning tomorrow for temple tour with Kai. Set 7am reminder.`,
  },
];

export const SPARSE_CONVERSATION_ABBREVIATIONS = [
  {
    title: "Arrival",
    abbreviation: `Hanan reported landing in Chiang Mai. Brief exchange, no detailed plans discussed yet.`,
  },
];

// --- Helper to assemble notebook content as the debrief prep job would receive it ---

export function assembleNotebookContext(input: {
  reference: Record<string, string>;
  daily: Record<string, string>;
  knowledge: Record<string, string>;
}): string {
  const sections: string[] = [];

  // Reference files
  if (Object.keys(input.reference).length > 0) {
    sections.push("## Reference Files\n");
    for (const [name, content] of Object.entries(input.reference)) {
      sections.push(`### ${name}\n${content}\n`);
    }
  }

  // Daily logs
  if (Object.keys(input.daily).length > 0) {
    sections.push("## Daily Logs\n");
    for (const [name, content] of Object.entries(input.daily)) {
      sections.push(`### ${name}\n${content}\n`);
    }
  }

  // Knowledge files
  if (Object.keys(input.knowledge).length > 0) {
    sections.push("## Knowledge\n");
    for (const [name, content] of Object.entries(input.knowledge)) {
      sections.push(`### ${name}\n${content}\n`);
    }
  }

  return sections.join("\n");
}

export function assembleDailySummaryContext(
  dailyLog: string,
  abbreviations: Array<{ title: string; abbreviation: string }>,
): string {
  const sections: string[] = [];

  sections.push("## Today's Daily Log\n");
  sections.push(dailyLog);
  sections.push("\n## Today's Conversation Summaries\n");

  for (const abbr of abbreviations) {
    sections.push(`### ${abbr.title}\n${abbr.abbreviation}\n`);
  }

  return sections.join("\n");
}
