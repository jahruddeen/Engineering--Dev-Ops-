import { setImmediate } from "node:timers/promises";
import { AnalysisCancelledError, AnalysisInputError, } from "../domain/analysisErrorCore.js";
import { err, ok } from "../domain/result.js";
import { mcpProgressReporter } from "./mcpProgress.js";
/** Run synchronous derived work with transport yields and a publication guard. */
export const runDerivedOperation = async (context, operation, compute) => {
    const progress = mcpProgressReporter(context);
    await progress.report({
        phase: "prepare",
        completed: 0,
        total: 2,
        message: `Preparing ${operation}`,
    });
    await setImmediate();
    if (context.mcpReq.signal.aborted)
        return err(new AnalysisCancelledError(operation));
    let value;
    try {
        value = compute();
    }
    catch (cause) {
        // Typed causes already name the failed constraint; keep their issues.
        return err(cause instanceof AnalysisCancelledError ||
            cause instanceof AnalysisInputError
            ? cause
            : new AnalysisInputError(operation, { cause }));
    }
    await progress.report({
        phase: "compute",
        completed: 1,
        total: 2,
        message: `Computed ${operation}`,
    });
    await setImmediate();
    if (context.mcpReq.signal.aborted)
        return err(new AnalysisCancelledError(operation));
    await progress.report({
        phase: "complete",
        completed: 2,
        total: 2,
        message: `Completed ${operation}`,
        terminal: true,
    });
    return ok(value);
};
