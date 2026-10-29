# -*- coding: utf-8 -*-
"""NCM (网易云音乐) 解密 -> 原始音频。

usage: py ncm2audio.py <in.ncm> [out]

注：部分新版客户端的 metadata 用了非公开密钥，解不开也不影响音频正文
（正文只依赖 core key + keybox），所以元数据失败时直接降级为「按魔数猜格式」。
"""
import sys, os, json, base64, struct

try:                                            # pycryptodome <4 导出 Cryptodome
    from Cryptodome.Cipher import AES
except ImportError:                             # pycryptodome >=4 只导出 Crypto
    from Crypto.Cipher import AES

CORE_KEY = bytes.fromhex('687A4852416D736F356B496E62617857')
META_KEY = bytes.fromhex('2331346C6A6B2F5D65335A63612F7C21')

MAGIC = [
    (b'fLaC', 'flac'),
    (b'ID3', 'mp3'),
    (b'OggS', 'ogg'),
    (b'RIFF', 'wav'),
    (b'\xff\xfb', 'mp3'), (b'\xff\xf3', 'mp3'), (b'\xff\xf2', 'mp3'),
    (b'\x00\x00\x00\x20ftyp', 'm4a'),
]


def unpad_pkcs7(b):
    return b[:-b[-1]]


def build_key_box(key_data):
    box = bytearray(range(256))
    n = len(key_data)
    j = 0
    for i in range(256):
        j = (box[i] + j + key_data[i % n]) & 0xff
        box[i], box[j] = box[j], box[i]
    return box


def decrypt(src, dst=None, dump_meta=True):
    with open(src, 'rb') as f:
        if f.read(8) != b'CTENFDAM':
            raise SystemExit('不是 ncm 文件')

        f.read(2)
        klen = struct.unpack('<I', f.read(4))[0]
        kdata = bytearray(f.read(klen))
        for i in range(len(kdata)):
            kdata[i] ^= 0x64
        kdata = unpad_pkcs7(AES.new(CORE_KEY, AES.MODE_ECB).decrypt(bytes(kdata)))
        if kdata[:17] != b'neteasecloudmusic':
            raise SystemExit('core key 解密失败: %r' % kdata[:17])
        key_data = kdata[17:]

        meta = {}
        mlen = struct.unpack('<I', f.read(4))[0]
        mblob = bytearray(f.read(mlen))
        for i in range(len(mblob)):
            mblob[i] ^= 0x63
        try:
            raw = bytes(mblob)[len(b"163 key(Don't modify):"):]
            dec = unpad_pkcs7(AES.new(META_KEY, AES.MODE_ECB).decrypt(base64.b64decode(raw)))
            txt = dec.decode('utf-8')
            meta = json.loads(txt[6:] if txt.startswith('music:') else txt)
        except Exception as e:
            print('[warn] metadata 解密失败（不影响音频）:', e)

        f.read(4)                                    # crc32
        f.read(5)                                    # gap
        ilen = struct.unpack('<I', f.read(4))[0]
        cover = f.read(ilen)

        box = build_key_box(key_data)
        head = b''
        ext = (meta.get('format') or '').lower() or None
        if dst is None:
            dst = os.path.splitext(src)[0] + '.' + (ext or 'bin')

        with open(dst, 'wb') as out:
            i_total = 0
            while True:
                chunk = bytearray(f.read(0x8000))
                if not chunk:
                    break
                n = len(chunk)
                for p in range(1, n + 1):
                    j = p & 0xff
                    chunk[p - 1] ^= box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff]
                out.write(chunk)
                if not head:
                    head = bytes(chunk[:16])
                i_total += n

    if not ext:
        for magic, e in MAGIC:
            if head.startswith(magic):
                ext = e
                break
        if ext and ext != os.path.splitext(dst)[1].lstrip('.'):
            dst2 = os.path.splitext(dst)[0] + '.' + ext
            os.replace(dst, dst2)
            dst = dst2

    print('head  :', head.hex(), '->', ext)
    print('meta  :', json.dumps(meta, ensure_ascii=False) if meta else '(不可用)')
    print('cover :', len(cover), 'bytes')
    print('audio :', dst, os.path.getsize(dst), 'bytes')
    if cover:
        cdst = os.path.splitext(dst)[0] + '.jpg'
        open(cdst, 'wb').write(cover)
        print('cover -> ', cdst)
    return meta, dst, cover


if __name__ == '__main__':
    decrypt(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
