"""Transcreve as gravações da campanha que chegam ao SFTP (bucket sftp-files).

Cada gravação é stereo: um canal por lado da conversa. Cada canal é
transcrito à parte com faster-whisper e o resultado fica no bucket em
`transcricoes/<nome>.json`. Gravações já transcritas são ignoradas.

Variáveis:
  S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
  WHISPER_MODEL   (default large-v3)
  LIMITE          máximo de gravações por execução (default 5; 0 = todas)
  TAMANHO_MINIMO  bytes; abaixo disto a gravação é ignorada (default 50000)
"""

import json
import os
import subprocess
import tempfile
import time

import boto3
from faster_whisper import WhisperModel

PREFIXO_AUDIO = "shared/"
PREFIXO_TRANSCRICOES = "transcricoes/"

MODELO = os.environ.get("WHISPER_MODEL", "large-v3")
LIMITE = int(os.environ.get("LIMITE", "5"))
TAMANHO_MINIMO = int(os.environ.get("TAMANHO_MINIMO", "50000"))


def log(evento: str, **dados: object) -> None:
    print(json.dumps({"evento": evento, **dados}, ensure_ascii=False), flush=True)


def cliente_s3():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        region_name=os.environ.get("S3_REGION", "auto"),
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    )


def listar(s3, bucket: str, prefixo: str) -> list[dict]:
    objetos: list[dict] = []
    for pagina in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefixo):
        objetos.extend(pagina.get("Contents", []))
    return objetos


def duracao_segundos(caminho: str) -> float:
    saida = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", caminho],
        capture_output=True, text=True, check=True,
    )
    return float(saida.stdout.strip() or 0)


def numero_canais(caminho: str) -> int:
    saida = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
         "-of", "csv=p=0", caminho],
        capture_output=True, text=True, check=True,
    )
    return int(saida.stdout.strip() or 1)


def extrair_canal(origem: str, canal: int, destino: str) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", origem, "-af", f"pan=mono|c0=c{canal}",
         "-ar", "16000", destino],
        check=True,
    )


def transcrever(modelo: WhisperModel, caminho: str) -> list[dict]:
    segmentos, _ = modelo.transcribe(caminho, language="pt", vad_filter=True, beam_size=5)
    return [{"inicio": round(s.start, 2), "fim": round(s.end, 2), "texto": s.text.strip()} for s in segmentos]


def main() -> None:
    bucket = os.environ["S3_BUCKET"]
    s3 = cliente_s3()

    feitas = {o["Key"][len(PREFIXO_TRANSCRICOES):-len(".json")] for o in listar(s3, bucket, PREFIXO_TRANSCRICOES)}
    audios = [o for o in listar(s3, bucket, PREFIXO_AUDIO) if o["Key"].lower().endswith(".mp3")]
    pequenas = [o for o in audios if o["Size"] < TAMANHO_MINIMO]
    pendentes = sorted(
        (o for o in audios if o["Size"] >= TAMANHO_MINIMO and os.path.basename(o["Key"])[:-4] not in feitas),
        key=lambda o: o["Key"],
    )
    log("inventario", total=len(audios), pequenas=len(pequenas), ja_transcritas=len(feitas),
        pendentes=len(pendentes), tamanho_total_mb=round(sum(o["Size"] for o in audios) / 1e6, 1))
    if LIMITE:
        pendentes = pendentes[:LIMITE]
    if not pendentes:
        return

    inicio = time.monotonic()
    modelo = WhisperModel(MODELO, device="cpu", compute_type="int8")
    log("modelo_carregado", modelo=MODELO, segundos=round(time.monotonic() - inicio, 1))

    for objeto in pendentes:
        nome = os.path.basename(objeto["Key"])[:-4]
        with tempfile.TemporaryDirectory() as pasta:
            audio = os.path.join(pasta, "audio.mp3")
            s3.download_file(bucket, objeto["Key"], audio)
            duracao = duracao_segundos(audio)
            canais = numero_canais(audio)

            t0 = time.monotonic()
            resultado: dict[str, list[dict]] = {}
            for canal in range(min(canais, 2)):
                wav = os.path.join(pasta, f"c{canal}.wav")
                extrair_canal(audio, canal, wav)
                resultado[f"canal_{canal}"] = transcrever(modelo, wav)
            processamento = time.monotonic() - t0

        s3.put_object(
            Bucket=bucket,
            Key=f"{PREFIXO_TRANSCRICOES}{nome}.json",
            Body=json.dumps({"ficheiro": objeto["Key"], "modelo": MODELO, "duracao_s": duracao,
                             "canais": canais, "segmentos": resultado}, ensure_ascii=False).encode(),
            ContentType="application/json",
        )
        log("transcrita", ficheiro=nome, canais=canais, duracao_s=round(duracao, 1),
            processamento_s=round(processamento, 1),
            fator=round(processamento / duracao, 2) if duracao else None,
            inicio_por_canal={c: " ".join(s["texto"] for s in segs)[:300] for c, segs in resultado.items()})


if __name__ == "__main__":
    main()
