# ==========================================
# Conversational context handling
# ==========================================
# Tracks recent turns so follow-up queries like "how do I get there"
# or "what about the second one" can resolve against the last
# mentioned entity/intent instead of failing as unknown.

class ConversationContext:

    def __init__(self, max_history=5):
        self.max_history = max_history
        self.history = []          # list of understood-query dicts
        self.last_entity = None
        self.last_intent = None
        self.qa_history = []       # list of {"question", "answer"} — see record_exchange

    def update(self, understood_query):
        self.history.append(understood_query)
        if len(self.history) > self.max_history:
            self.history.pop(0)

        if understood_query["entities"]:
            self.last_entity = understood_query["entities"][-1]

        if understood_query["intent"] != "unknown":
            self.last_intent = understood_query["intent"]

    def record_exchange(self, question_text, answer_text):
        """
        Stores a completed question/answer turn once the RAG has actually
        answered it. This is what lets a follow-up like "name all of them"
        get resolved by the RAG itself from conversational continuity, for
        the many cases entity-substitution alone can't cover — "them" here
        refers to a list the previous *answer* gave, not any single named
        entity resolve_followup could have filled in.
        """

        self.qa_history.append({"question": question_text, "answer": answer_text})
        if len(self.qa_history) > self.max_history:
            self.qa_history.pop(0)

    def recent_exchanges(self, limit=2):
        """Last `limit` question/answer turns, oldest first — kept short since
        this gets threaded into every RAG prompt and costs real tokens."""

        return self.qa_history[-limit:]

    # only these intents make sense to resolve against a prior entity —
    # greetings/goodbyes/help never need one, so skip them
    ENTITY_DEPENDENT_INTENTS = {
        "find_location", "get_directions", "get_timing", "get_contact", "get_info"
    }

    # Words that actually signal "the thing I mean is whatever we were just
    # talking about" — "how do I get there", "what about its timing", "name
    # all of them". Without requiring one of these, a topic-shifting query
    # with no entity of its own (e.g. "list all of the departments" right
    # after asking about the principal) would silently inherit the old,
    # unrelated entity instead of correctly having none. get_info in
    # particular covers questions on wildly different topics turn to turn,
    # so it needs this guard more than the other, narrower intents do.
    REFERENTIAL_WORDS = {
        "it", "its", "there", "that", "them", "those", "this", "these", "they",
    }

    def resolve_followup(self, understood_query):
        """
        If the current query has no entity but its intent needs one and
        the phrasing itself points back at something ("how do I get
        there", "what about its timing"), fill in the last known entity
        so downstream modules still get a usable structured query.
        """

        needs_entity = understood_query["intent"] in self.ENTITY_DEPENDENT_INTENTS
        is_referential = bool(
            self.REFERENTIAL_WORDS & set(understood_query["clean_text"].split())
        )

        if needs_entity and is_referential and not understood_query["entities"] and self.last_entity:
            understood_query["entities"] = [self.last_entity]
            understood_query["resolved_from_context"] = True
        else:
            understood_query["resolved_from_context"] = False

        return understood_query

    def reset(self):
        self.history = []
        self.last_entity = None
        self.last_intent = None
        self.qa_history = []
