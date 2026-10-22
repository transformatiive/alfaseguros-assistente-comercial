import { GetObjectCommand, ListObjectsV2Command, S3Client, type _Object } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { env } from "../lib/env.js";

/**
 * Acesso ao bucket `sftp-files` (Railway, projeto Alfaseguros-SFTP), onde a
 * Solidnetworks deixa as gravações (`shared/`) e o transcritor escreve as
 * transcrições (`transcricoes/`). Só leitura.
 */

export const PREFIXO_AUDIO = "shared/";
export const PREFIXO_TRANSCRICOES = "transcricoes/";

let cliente: { s3: S3Client; bucket: string } | null = null;

/** null quando as variáveis SFTP_S3_* não estão definidas. */
export function bucket(): { s3: S3Client; bucket: string } | null {
  if (cliente) return cliente;
  const cfg = env();
  if (!cfg.SFTP_S3_ENDPOINT || !cfg.SFTP_S3_BUCKET || !cfg.SFTP_S3_ACCESS_KEY_ID || !cfg.SFTP_S3_SECRET_ACCESS_KEY) {
    return null;
  }
  cliente = {
    bucket: cfg.SFTP_S3_BUCKET,
    s3: new S3Client({
      endpoint: cfg.SFTP_S3_ENDPOINT,
      region: cfg.SFTP_S3_REGION,
      forcePathStyle: false,
      credentials: {
        accessKeyId: cfg.SFTP_S3_ACCESS_KEY_ID,
        secretAccessKey: cfg.SFTP_S3_SECRET_ACCESS_KEY,
      },
    }),
  };
  return cliente;
}

export async function listar(prefixo: string): Promise<_Object[]> {
  const b = bucket();
  if (!b) return [];
  const objetos: _Object[] = [];
  let token: string | undefined;
  do {
    const r = await b.s3.send(
      new ListObjectsV2Command({ Bucket: b.bucket, Prefix: prefixo, ContinuationToken: token }),
    );
    objetos.push(...(r.Contents ?? []));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return objetos;
}

export async function lerJson(chave: string): Promise<unknown> {
  const b = bucket();
  if (!b) throw new Error("Bucket do SFTP não configurado");
  const r = await b.s3.send(new GetObjectCommand({ Bucket: b.bucket, Key: chave }));
  if (!r.Body) throw new Error(`Objeto vazio: ${chave}`);
  return JSON.parse(await r.Body.transformToString("utf-8"));
}

export interface Audio {
  corpo: Readable;
  tamanho: number | undefined;
  intervalo: string | undefined;
  tipo: string;
}

/** Lê o mp3, respeitando o cabeçalho Range para o leitor poder saltar no áudio. */
export async function lerAudio(chave: string, range: string | undefined): Promise<Audio> {
  const b = bucket();
  if (!b) throw new Error("Bucket do SFTP não configurado");
  const r = await b.s3.send(new GetObjectCommand({ Bucket: b.bucket, Key: chave, Range: range }));
  if (!r.Body) throw new Error(`Objeto vazio: ${chave}`);
  return {
    corpo: r.Body as Readable,
    tamanho: r.ContentLength,
    intervalo: r.ContentRange,
    tipo: r.ContentType && r.ContentType !== "binary/octet-stream" ? r.ContentType : "audio/mpeg",
  };
}
