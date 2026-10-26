-- Financial source immutability: an existing NovaPay registry number must never
-- be silently replaced by a different source file.

CREATE TRIGGER IF NOT EXISTS trg_novapay_registry_hash_immutable
BEFORE UPDATE OF file_sha256 ON novapay_registries
FOR EACH ROW
WHEN OLD.file_sha256 <> NEW.file_sha256
BEGIN
  SELECT RAISE(ABORT, 'NOVAPAY_REGISTRY_IMMUTABLE_HASH_CONFLICT');
END;
