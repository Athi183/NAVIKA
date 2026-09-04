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

    def update(self, understood_query):
        self.history.append(understood_query)
        if len(self.history) > self.max_history:
            self.history.pop(0)

        if understood_query["entities"]:
            self.last_entity = understood_query["entities"][-1]

        if understood_query["intent"] != "unknown":
            self.last_intent = understood_query["intent"]

    # only these intents make sense to resolve against a prior entity —
    # greetings/goodbyes/help never need one, so skip them
    ENTITY_DEPENDENT_INTENTS = {
        "find_location", "get_directions", "get_timing", "get_contact"
    }

    def resolve_followup(self, understood_query):
        """
        If the current query has no entity but its intent needs one
        (e.g. "how do I get there", "what about its timing"), fill in
        the last known entity so downstream modules still get a usable
        structured query.
        """

        needs_entity = understood_query["intent"] in self.ENTITY_DEPENDENT_INTENTS

        if needs_entity and not understood_query["entities"] and self.last_entity:
            understood_query["entities"] = [self.last_entity]
            understood_query["resolved_from_context"] = True
        else:
            understood_query["resolved_from_context"] = False

        return understood_query

    def reset(self):
        self.history = []
        self.last_entity = None
        self.last_intent = None
