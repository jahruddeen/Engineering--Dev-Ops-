import { isAbsolute, relative, sep } from "node:path";
/** True when the value is an absolute filesystem path on the host platform. */
export const isAbsoluteLocalPath = (value) => isAbsolute(value);
/** Test lexical containment on the host platform; callers must resolve symlinks first. */
export const isPathWithinRoot = (root, path) => {
    const value = relative(root, path);
    return (value === "" ||
        (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value)));
};
