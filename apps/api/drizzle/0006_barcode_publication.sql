-- Sync the barcode memory to clients (zero-cache replicates only the zero_app publication).
ALTER PUBLICATION zero_app ADD TABLE barcode;
