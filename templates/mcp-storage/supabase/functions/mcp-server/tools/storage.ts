import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";
import { errorResult, jsonResult, runtimeErrorResult } from "./result.ts";

function storageError(error: { message?: string } | null): string {
  return error?.message ?? "Storage operation failed.";
}

export function registerStorageTools(
  server: McpServer,
  { supabase }: ToolContext,
): void {
  server.registerTool(
    "list_storage_objects",
    {
      description:
        "List objects in a Supabase Storage bucket prefix as the signed-in user. Storage policies apply.",
      inputSchema: {
        bucket: z.string().min(1).describe("Storage bucket id."),
        prefix: z.string().default("").describe("Optional folder prefix."),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (
      input: { bucket: string; prefix: string; limit: number; offset: number },
    ) => {
      try {
        const { data, error } = await supabase.storage.from(input.bucket).list(
          input.prefix,
          {
            limit: input.limit,
            offset: input.offset,
            sortBy: { column: "name", order: "asc" },
          },
        );
        if (error) return errorResult(storageError(error));
        return jsonResult({ bucket: input.bucket, prefix: input.prefix, objects: data ?? [] });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "create_signed_download_url",
    {
      description:
        "Create a short-lived signed download URL for one object. Storage policies apply.",
      inputSchema: {
        bucket: z.string().min(1),
        path: z.string().min(1),
        expiresInSeconds: z.number().int().min(60).max(604_800).default(3_600),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (
      input: { bucket: string; path: string; expiresInSeconds: number },
    ) => {
      try {
        const { data, error } = await supabase.storage.from(input.bucket)
          .createSignedUrl(input.path, input.expiresInSeconds);
        if (error) return errorResult(storageError(error));
        return jsonResult(data);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "create_signed_upload_url",
    {
      description:
        "Create a short-lived signed upload URL for one object path. Storage policies apply.",
      inputSchema: {
        bucket: z.string().min(1),
        path: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input: { bucket: string; path: string }) => {
      try {
        const { data, error } = await supabase.storage.from(input.bucket)
          .createSignedUploadUrl(input.path);
        if (error) return errorResult(storageError(error));
        return jsonResult(data);
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "move_storage_object",
    {
      description:
        "Move or rename one object in a bucket as the signed-in user. Storage policies apply.",
      inputSchema: {
        bucket: z.string().min(1),
        fromPath: z.string().min(1),
        toPath: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input: { bucket: string; fromPath: string; toPath: string }) => {
      try {
        const { data, error } = await supabase.storage.from(input.bucket).move(
          input.fromPath,
          input.toPath,
        );
        if (error) return errorResult(storageError(error));
        return jsonResult(data ?? { moved: true });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "copy_storage_object",
    {
      description:
        "Copy one object in a bucket as the signed-in user. Storage policies apply.",
      inputSchema: {
        bucket: z.string().min(1),
        fromPath: z.string().min(1),
        toPath: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input: { bucket: string; fromPath: string; toPath: string }) => {
      try {
        const { data, error } = await supabase.storage.from(input.bucket).copy(
          input.fromPath,
          input.toPath,
        );
        if (error) return errorResult(storageError(error));
        return jsonResult(data ?? { copied: true });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_storage_objects",
    {
      description:
        "Delete up to 50 objects from one bucket as the signed-in user. Storage policies apply.",
      inputSchema: {
        bucket: z.string().min(1),
        paths: z.array(z.string().min(1)).min(1).max(50),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input: { bucket: string; paths: string[] }) => {
      try {
        const { data, error } = await supabase.storage.from(input.bucket)
          .remove(input.paths);
        if (error) return errorResult(storageError(error));
        return jsonResult({ deleted: data ?? [], count: data?.length ?? 0 });
      } catch (error) {
        return runtimeErrorResult(error);
      }
    },
  );
}
