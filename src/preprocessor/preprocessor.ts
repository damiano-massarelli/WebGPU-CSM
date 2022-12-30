export function preprocess(
    code: string,
    defines: Record<string, string> = {},
    checks: Record<string, boolean> = {}
) {
    const ifRegex = /#if (?<condition>.+)/;
    const elseRegex = /#else/;
    const endifRegex = /#endif/;
    const elseifRegex = /#elseif (?<condition>.+)/;

    const replaceRegex = /##(?<name>[^=]+)(=(?<default>.+))?##/g;

    const lines = code.split(`\n`);

    let finalText = "";
    let isIgnoring = [false];
    let conditionPassed = [false];

    for (const line of lines) {
        let match = line.match(ifRegex);

        // #if
        if (match !== null) {
            if (match.groups != null) {
                const nextIgnore = !(
                    checks[match.groups["condition"].trim()] === true
                );
                isIgnoring.push(nextIgnore);
                conditionPassed.push(!nextIgnore);
            } else {
                throw new Error("Found #if without condition");
            }

            continue; // always skip an #if line
        }

        // #elseif
        match = line.match(elseifRegex);
        if (match !== null && match.groups != null) {
            if (isIgnoring.length < 2) {
                throw new Error("#if / #else / #endif mismatch!");
            }
            if (conditionPassed[conditionPassed.length - 1] === false) {
                // only consider if last condition did not pass
                const nextIgnore = !(
                    checks[match.groups["condition"].trim()] === true
                );
                isIgnoring[isIgnoring.length - 1] = nextIgnore;
                conditionPassed[conditionPassed.length - 1] = !nextIgnore;
            } else {
                isIgnoring[isIgnoring.length - 1] = true;
            }

            continue;
        }

        // #else
        match = line.match(elseRegex);
        if (match !== null) {
            if (isIgnoring.length < 2) {
                throw new Error("#if / #else mismatch!");
            }

            if (conditionPassed[conditionPassed.length - 1] === false) {
                isIgnoring[isIgnoring.length - 1] = false;
            } else {
                isIgnoring[isIgnoring.length - 1] = true;
            }

            continue; // always skip an #else line
        }

        // #endif
        match = line.match(endifRegex);
        if (match !== null) {
            if (isIgnoring.length < 2) {
                throw new Error("#if / #endif mismatch!");
            }

            isIgnoring.pop();
            conditionPassed.pop();

            continue;
        }

        if (isIgnoring[isIgnoring.length - 1] === false) {
            finalText += line + `\n`;
        }
    }

    if (isIgnoring.length !== 1) {
        throw new Error("#if / #else / #endif mismatch!");
    }

    const matches = finalText.matchAll(replaceRegex);
    if (matches != null) {
        for (let match of matches) {
            if (match.groups != null) {
                const defineName = match.groups["name"];
                const defineValue =
                    defines[defineName] ?? match.groups["default"];

                if (defineValue == null) {
                    throw new Error(
                        `no define value or default value for '${defineName}'`
                    );
                }

                finalText = finalText.replace(match[0], defineValue);
            }
        }
    }

    return finalText;
}
