export type FeedEventKind =
    | "fine"
    | "toll"
    | "ferry"
    | "train"
    | "delivered"
    | "cancelled"
    | "achievement";

export interface FeedEvent {
    id: number;
    kind: FeedEventKind;
    /** Money involved; positive number, sign meaning comes from the kind. */
    amount: number;
    /** Raw context from the game: offence text or "A → B". */
    label: string;
    /** Formatted game clock of when it happened, e.g. "Tue 14:32". */
    gameTime: string;
}

const MAX_EVENTS = 50;

const feedState = reactive<{
    events: FeedEvent[];
    latest: FeedEvent | null;
    unreadCount: number;
}>({
    events: [],
    latest: null,
    unreadCount: 0,
});

let nextEventId = 1;

export function useEventFeed() {
    function pushEvent(
        kind: FeedEventKind,
        amount: number,
        label: string,
        gameTime: string,
    ) {
        const event: FeedEvent = {
            id: nextEventId++,
            kind,
            amount,
            label,
            gameTime,
        };

        feedState.events.unshift(event);
        if (feedState.events.length > MAX_EVENTS) {
            feedState.events.splice(MAX_EVENTS);
        }

        feedState.latest = event;
        feedState.unreadCount++;
    }

    function markEventsRead() {
        feedState.unreadCount = 0;
    }

    function clearEventFeed() {
        feedState.events = [];
        feedState.unreadCount = 0;
    }

    return {
        events: toRef(feedState, "events"),
        latest: toRef(feedState, "latest"),
        unreadCount: toRef(feedState, "unreadCount"),
        pushEvent,
        markEventsRead,
        clearEventFeed,
    };
}
