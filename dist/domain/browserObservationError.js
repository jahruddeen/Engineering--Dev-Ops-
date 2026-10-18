import { AnalysisError } from "./analysisErrorBase.js";
import { AnalysisCancelledError } from "./analysisErrorCore.js";
/** A bounded passive browser observation failed at its CDP boundary. */
export class BrowserObservationError extends AnalysisError {
    operation;
    reason;
    _tag = "BrowserObservationError";
    cleanupIncomplete;
    cleanupResources;
    userCategory;
    userMessage;
    constructor(operation, reason, options) {
        super(`Browser observation ${operation} failed: ${reason}`, options);
        this.operation = operation;
        this.reason = reason;
        this.userMessage = options?.detail;
        this.cleanupIncomplete = reason === "cleanup_failed";
        this.cleanupResources =
            reason === "cleanup_failed" ? ["browser_transport"] : [];
        this.userCategory =
            reason === "cancelled" || options?.cause instanceof AnalysisCancelledError
                ? "cancelled"
                : undefined;
    }
}
