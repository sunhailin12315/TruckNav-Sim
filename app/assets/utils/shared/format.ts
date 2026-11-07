/** Shared money formatting for the game's two currencies. */
export function currencySymbolFor(game: string | null | undefined): string {
    return game === "ats" ? "$" : "€";
}

export function formatMoney(amount: number, symbol: string): string {
    return `${Math.round(amount).toLocaleString()} ${symbol}`;
}
