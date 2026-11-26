"""Learning path of the desktop app: levels, units and first-use questions.

Units are described by what the learner can do ("talk about the past"), not
by the grammar of one language, so the same path serves the six languages of
the tutor; the model turns each unit into lesson content for the language.
"""

LEVELS = [
    {
        "code": "A1",
        "name": "Débutant",
        "hint": "Je connais quelques mots, ou rien du tout.",
    },
    {
        "code": "A2",
        "name": "Élémentaire",
        "hint": "Je me débrouille avec des phrases simples.",
    },
    {
        "code": "B1",
        "name": "Intermédiaire",
        "hint": "Je tiens une conversation, avec des erreurs.",
    },
    {
        "code": "B2",
        "name": "Avancé",
        "hint": "Je parle avec aisance et je veux gagner en précision.",
    },
]
LEVEL_CODES = [level["code"] for level in LEVELS]

# (title shown in French, grammar goal for the model, vocabulary theme for the model)
_UNITS = {
    "A1": [
        (
            "Se présenter",
            "the verb 'to be' and subject pronouns",
            "greetings and introductions",
        ),
        (
            "La famille et les proches",
            "possessives and the verb 'to have'",
            "family and people",
        ),
        (
            "Le quotidien",
            "present tense of common verbs for daily routine",
            "daily routine and telling the time",
        ),
        (
            "Manger et boire",
            "articles and plurals; saying what you like",
            "food and drinks",
        ),
        (
            "Poser des questions",
            "simple questions and negative sentences",
            "places in town",
        ),
        (
            "Chez soi",
            "'there is / there are' and prepositions of place",
            "home and furniture",
        ),
    ],
    "A2": [
        (
            "Raconter au passé",
            "the main past tense for finished actions",
            "weekend and leisure activities",
        ),
        (
            "Faire des projets",
            "talking about future plans and intentions",
            "travel and transport",
        ),
        ("Comparer", "comparatives and superlatives", "describing people and things"),
        (
            "Au restaurant et en courses",
            "polite requests and quantities",
            "shopping and eating out",
        ),
        (
            "Donner des conseils",
            "obligation and advice (must, should, have to)",
            "health and the body",
        ),
        (
            "Habitudes passées",
            "past habits and background descriptions",
            "childhood and memories",
        ),
    ],
    "B1": [
        (
            "Expériences de vie",
            "life experiences and recent events (perfect aspect or its equivalent)",
            "work and career",
        ),
        ("Si… alors", "real and hypothetical conditions", "environment and nature"),
        (
            "Donner son avis",
            "expressing opinions, agreeing, disagreeing, linking words",
            "media and technology",
        ),
        ("Rapporter des paroles", "reported speech", "news and society"),
        ("Décrire précisément", "relative clauses", "feelings and personality"),
        ("La voix passive", "the passive voice", "culture and the arts"),
    ],
    "B2": [
        (
            "Nuancer",
            "expressing probability, doubt and certainty",
            "abstract ideas and debate",
        ),
        ("Regrets et hypothèses", "unreal past conditions and regrets", "life choices"),
        (
            "Convaincre",
            "advanced connectors and structuring an argument",
            "business and negotiation",
        ),
        (
            "Expressions idiomatiques",
            "common idioms and multi-word verbs",
            "idiomatic everyday language",
        ),
        (
            "Registres",
            "formal versus informal register",
            "formal correspondence and meetings",
        ),
        ("Raconter avec style", "narrative tenses used together", "storytelling"),
    ],
}

LESSON_KINDS = ["vocab", "grammar", "pron"]


def units(level: str) -> list[dict]:
    return [
        {
            "id": f"{level}-{index + 1}",
            "level": level,
            "number": index + 1,
            "title": title,
            "grammar": grammar,
            "vocab": vocab,
        }
        for index, (title, grammar, vocab) in enumerate(_UNITS[level])
    ]


def unit(unit_id: str) -> dict:
    level = unit_id.split("-")[0]
    for item in units(level):
        if item["id"] == unit_id:
            return item
    raise KeyError(unit_id)


# First-use questions, easiest first; answered aloud, then read by the model
# to estimate the starting level. `fr` is the help shown on request.
STARTER_QUESTIONS = {
    "en": [
        (
            "What is your name, and where do you live?",
            "Comment tu t'appelles, et où habites-tu ?",
        ),
        (
            "What did you do last weekend?",
            "Qu'est-ce que tu as fait le week-end dernier ?",
        ),
        (
            "If you could change one thing about your city, what would it be, and why?",
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
        ),
    ],
    "fr": [
        (
            "Comment tu t'appelles, et où habites-tu ?",
            "Comment tu t'appelles, et où habites-tu ?",
        ),
        (
            "Qu'est-ce que tu as fait le week-end dernier ?",
            "Qu'est-ce que tu as fait le week-end dernier ?",
        ),
        (
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
        ),
    ],
    "es": [
        ("¿Cómo te llamas y dónde vives?", "Comment tu t'appelles, et où habites-tu ?"),
        (
            "¿Qué hiciste el fin de semana pasado?",
            "Qu'est-ce que tu as fait le week-end dernier ?",
        ),
        (
            "Si pudieras cambiar una cosa de tu ciudad, ¿qué sería y por qué?",
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
        ),
    ],
    "de": [
        ("Wie heißt du und wo wohnst du?", "Comment tu t'appelles, et où habites-tu ?"),
        (
            "Was hast du letztes Wochenende gemacht?",
            "Qu'est-ce que tu as fait le week-end dernier ?",
        ),
        (
            "Wenn du eine Sache in deiner Stadt ändern könntest, was wäre das und warum?",
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
        ),
    ],
    "it": [
        ("Come ti chiami e dove abiti?", "Comment tu t'appelles, et où habites-tu ?"),
        (
            "Che cosa hai fatto lo scorso fine settimana?",
            "Qu'est-ce que tu as fait le week-end dernier ?",
        ),
        (
            "Se potessi cambiare una cosa della tua città, quale sarebbe e perché?",
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
        ),
    ],
    "pt": [
        (
            "Como você se chama e onde mora?",
            "Comment tu t'appelles, et où habites-tu ?",
        ),
        (
            "O que você fez no último fim de semana?",
            "Qu'est-ce que tu as fait le week-end dernier ?",
        ),
        (
            "Se você pudesse mudar uma coisa na sua cidade, o que seria e por quê?",
            "Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?",
        ),
    ],
}

# What the conversation partner is told about the learner's level.
LEVEL_GUIDANCE = {
    "A1": "The learner is a beginner (CEFR A1). Use very short, simple sentences, the most common words, the present tense, and speak about concrete everyday things. Ask one simple question at a time.",
    "A2": "The learner is at an elementary level (CEFR A2). Use simple sentences and common vocabulary, mostly present, past and near future. Ask one clear question at a time.",
    "B1": "The learner is at an intermediate level (CEFR B1). Use natural everyday language, avoid rare words and idioms, and invite the learner to explain and give opinions.",
    "B2": "The learner is at an upper-intermediate level (CEFR B2). Speak naturally, with varied vocabulary and some idioms, and challenge the learner with nuanced questions.",
}
