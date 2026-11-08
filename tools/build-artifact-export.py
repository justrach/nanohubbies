"""Trusted VM-side reader. Never extract candidate archive paths to disk."""
import hashlib
import json
import os
import stat
import subprocess
import sys
import tarfile


def export(source, destination, max_bytes, max_files):
    os.mkdir(destination, 0o700)
    blobs = destination + "/blobs"
    os.mkdir(blobs, 0o700)
    basename = source.rsplit("/", 1)[1]
    maximum_entries = max_files * 2 + 100
    maximum_archive = max_bytes + maximum_entries * 4096 + 1048576
    # Inspect the stopped job's persistent snapshot before tar can silently
    # omit unsupported entries (for example Unix sockets). Never follow links.
    if not stat.S_ISDIR(os.lstat(source).st_mode):
        raise ValueError("Output snapshot must be a directory")
    expected, visited, expected_bytes = {}, 1, 0

    def inspect(directory, prefix=""):
        nonlocal visited, expected_bytes
        with os.scandir(directory) as children:
            for child in children:
                visited += 1
                path = prefix + child.name
                if (visited > maximum_entries or len(path.encode("utf-8")) > 1024 or
                        len(path.split("/")) > 32 or
                        any(ord(c) < 32 or ord(c) == 127 or c == "\\" for c in path)):
                    raise ValueError("Output snapshot exceeds its bounds")
                info = child.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    inspect(child.path, path + "/")
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    expected_bytes += info.st_size
                    expected[path] = info.st_size
                    if expected_bytes > max_bytes or len(expected) > max_files:
                        raise ValueError("Output snapshot exceeds its bounds")
                else:
                    raise ValueError("Unsupported output snapshot entry")

    inspect(source)
    process = subprocess.Popen(
        # No --dereference: links in the candidate snapshot remain links and
        # are refused by the bounded reader below. Nothing is extracted.
        ["tar", "-C", os.path.dirname(source), "-cf", "-", os.path.basename(source)],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C"},
    )

    class Reader:
        consumed = 0

        def read(self, size):
            value = process.stdout.read(size)
            self.consumed += len(value)
            if self.consumed > maximum_archive:
                raise ValueError("Archive exceeds its bound")
            return value

    reader = Reader()
    files, seen, regular, directories = [], set(), set(), set()
    total, entries = 0, 0
    root_seen = False
    try:
        with tarfile.open(fileobj=reader, mode="r|") as archive:
            for entry in archive:
                entries += 1
                if entries > maximum_entries:
                    raise ValueError("Too many archive entries")
                name = entry.name.rstrip("/") if entry.isdir() else entry.name
                parts = name.split("/")
                if (not name or len(name.encode("utf-8")) > 2048 or
                        len(parts) > 33 or parts[0] != basename or
                        any(p in ("", ".", "..") for p in parts) or
                        any(ord(c) < 32 or ord(c) == 127 or c == "\\" for c in name)):
                    raise ValueError("Unsafe archive path")
                if name in seen:
                    raise ValueError("Duplicate archive path")
                seen.add(name)
                if any("/".join(parts[:i]) in regular for i in range(1, len(parts))):
                    raise ValueError("File/directory conflict")
                for i in range(1, len(parts)):
                    directories.add("/".join(parts[:i]))
                if not entry.isdir() and (not entry.isreg() or entry.issparse()):
                    raise ValueError("Only regular files and directories are supported")
                if not entry.isdir() and name in directories:
                    raise ValueError("File/directory conflict")
                if entry.isdir():
                    directories.add(name)
                if len(parts) == 1:
                    if not entry.isdir():
                        raise ValueError("Output must be a directory")
                    root_seen = True
                    continue
                if entry.isdir():
                    continue
                relative = "/".join(parts[1:])
                if len(relative.encode("utf-8")) > 1024:
                    raise ValueError("Output path exceeds its bound")
                if entry.size < 0 or total + entry.size > max_bytes or len(files) >= max_files:
                    raise ValueError("Output exceeds its bound")
                regular.add(name)
                total += entry.size
                temporary = blobs + "/pending-" + str(len(files))
                digest, copied = hashlib.sha256(), 0
                with archive.extractfile(entry) as stream, open(temporary, "xb") as output:
                    os.chmod(temporary, 0o600)
                    while True:
                        block = stream.read(min(65536, entry.size - copied + 1))
                        if not block:
                            break
                        copied += len(block)
                        if copied > entry.size:
                            raise ValueError("Output size changed")
                        output.write(block)
                        digest.update(block)
                if copied != entry.size:
                    raise ValueError("Incomplete output")
                sha = digest.hexdigest()
                os.replace(temporary, blobs + "/" + sha)
                files.append({"path": relative, "bytes": copied, "sha256": sha})
        # Consume bounded padding/trailing bytes before checking tar's exit.
        while reader.read(65536):
            pass
        if (process.wait(timeout=30) != 0 or not root_seen or not files or
                {item["path"]: item["bytes"] for item in files} != expected):
            raise ValueError("Output copy did not finish")
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    files.sort(key=lambda item: item["path"].encode("utf-8"))
    manifest = json.dumps({"format": 1, "files": files, "totalBytes": total},
                          ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(manifest) > 4194304:
        raise ValueError("Output manifest exceeds its bound")
    with open(destination + "/manifest.json", "xb") as output:
        os.chmod(destination + "/manifest.json", 0o600)
        output.write(manifest)
    print(json.dumps({"bytes": len(manifest), "sha256": hashlib.sha256(manifest).hexdigest()}))


if __name__ == "__main__":
    try:
        export(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
    except ValueError:
        print("Build output rejected", file=sys.stderr)
        sys.exit(2)
    except Exception:
        # Candidate paths and content do not belong in controller errors.
        print("Build output export failed", file=sys.stderr)
        sys.exit(1)
