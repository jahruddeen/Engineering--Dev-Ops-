import { buildCapabilityInventory } from "../application/CapabilityInventory.js";
import { toolContract } from "../contracts/toolContracts.js";
import { jsonObjectSchema } from "../domain/jsonValue.js";
import { createServerIdentity } from "../serverIdentity.js";
import { mcpClientMetadata } from "./mcpClientMetadata.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { toCallToolResult } from "./toolResult.js";
/** Register the read-only provider and target status operation. */
export const registerSessionStatusTool = (options) => {
    const { server, session, contract, startedAt, availabilityPolicy } = options;
    server.registerTool(contract.name, toolRegistrationOptions(contract), (input, context) => {
        const { client, clientFeatures, protocolVersion } = mcpClientMetadata(context);
        const status = session.status();
        const statusObject = jsonObjectSchema.parse(status);
        const toolAvailability = buildCapabilityInventory(status, availabilityPolicy(), clientFeatures);
        const serverIdentity = createServerIdentity({
            startedAt,
            expected: {
                ...(input.expected_package_version === undefined
                    ? {}
                    : { package_version: input.expected_package_version }),
                ...(input.expected_catalog_digest === undefined
                    ? {}
                    : { catalog_digest: input.expected_catalog_digest }),
                ...(input.expected_server_path === undefined
                    ? {}
                    : { server_path: input.expected_server_path }),
            },
            ...(client === undefined ? {} : { client }),
            ...(protocolVersion === undefined ? {} : { protocolVersion }),
        });
        return toCallToolResult({
            ok: true,
            value: projectSessionStatus({
                status: statusObject,
                toolAvailability,
                serverIdentity,
                clientFeatures,
            }),
        }, contract);
    });
};
const projectSessionStatus = (options) => jsonObjectSchema.parse({
    ...options.status,
    tool_availability: options.toolAvailability,
    client_features: options.clientFeatures,
    server_identity: options.serverIdentity,
});
