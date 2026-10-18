import { execFile, } from "node:child_process";
/** Run a shell-free command while capturing its complete UTF-8 output. */
export const execFileOutput = (command, arguments_, options = {}) => new Promise((resolve, reject) => {
    execFile(command, [...arguments_], {
        ...options,
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? Number.POSITIVE_INFINITY,
    }, (error, stdout, stderr) => {
        if (error !== null) {
            Reflect.set(error, "stdout", stdout);
            Reflect.set(error, "stderr", stderr);
            reject(error);
            return;
        }
        resolve({ stdout, stderr });
    });
});
