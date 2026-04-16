import { PDFDocument } from 'pdf-lib';
import { decryptPDF } from 'pdf-encrypt-decrypt';

export class PDFEncryptionChecker {
    constructor(pdfBuffer) {
        this.buffer = pdfBuffer;
        this._encrypted = null;
        console.log(`PDF buffer size: ${pdfBuffer.length}`);
    }

    async isEncrypted() {
        if (this._encrypted !== null) return this._encrypted;
        try {
            await PDFDocument.load(this.buffer, { parsePages: false });
            this._encrypted = false;
        } catch (err) {
            const msg = err.message.toLowerCase();
            this._encrypted = msg.includes('encrypted');
        }
        return this._encrypted;
    }

    async validatePassword(password) {
        try {
            const decryptedPdfBuffer = await decryptPDF(this.buffer, password);

            // Only log on success
            console.log(`Decryption successful`);
            console.log(`Output buffer length: ${decryptedPdfBuffer.length}`);

            return {
                success: true,
                data: decryptedPdfBuffer,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
            };
        }
    }
}