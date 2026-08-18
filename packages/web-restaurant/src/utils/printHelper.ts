import { isNativePlatform, nativePrintHtml } from '../lib/native';

export async function printHtmlString(htmlString: string, title = 'Impresión') {
  if (isNativePlatform()) {
    // En la app nativa el diálogo web de impresión no existe; se usa el
    // PrintManager de Android. Si falla, se intenta el flujo web como fallback.
    const printed = await nativePrintHtml(`<!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <meta charset="utf-8">
            <style>
              @page {
                margin: 0; /* Important for thermal printers */
              }
              body {
                margin: 0;
                padding: 10px;
                background-color: white;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            </style>
          </head>
          <body>
            ${htmlString}
          </body>
        </html>`);
    if (printed) return;
  }

  return new Promise<void>((resolve, reject) => {
    try {
      const iframe = document.createElement('iframe');
      // Set iframe to be practically invisible but still part of the document flow
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';

      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        document.body.removeChild(iframe);
        throw new Error('No se pudo acceder al documento del iframe para imprimir');
      }

      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <meta charset="utf-8">
            <style>
              /* Base resets and print specific styles */
              @page {
                margin: 0; /* Important for thermal printers */
              }
              body {
                margin: 0;
                padding: 10px;
                background-color: white;
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            </style>
          </head>
          <body>
            ${htmlString}
          </body>
        </html>
      `);
      iframeDoc.close();

      // Wait for content to load, including images/fonts if any
      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            
            // Clean up after print dialogue closes
            setTimeout(() => {
              document.body.removeChild(iframe);
              resolve();
            }, 1000);
          } catch (e) {
            document.body.removeChild(iframe);
            reject(e);
          }
        }, 500); // Small delay to ensure rendering is complete
      };
      
      // Fallback if onload doesn't fire
      setTimeout(() => {
        if (document.body.contains(iframe)) {
           try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => {
              if (document.body.contains(iframe)) document.body.removeChild(iframe);
              resolve();
            }, 1000);
          } catch (e) {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
            reject(e);
          }
        }
      }, 2000);

    } catch (error) {
      reject(error);
    }
  });
}
