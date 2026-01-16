const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event, context) {
  // Cabeçalhos para permitir que o admin chame essa função
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { saleId } = JSON.parse(event.body);

    if (!saleId) throw new Error("ID da venda não informado.");

    // 1. Conecta aos serviços
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 2. Busca os dados da venda e do produto
    const { data: sale, error: saleError } = await supabase
        .from('sales')
        .select('*, products(*)') // Puxa a venda E os dados do produto junto
        .eq('id', saleId)
        .single();

    if (saleError || !sale) throw new Error("Venda não encontrada.");

    const product = sale.products; // O Supabase já traz os dados do produto aqui

    // 3. Gera um NOVO link de download (válido por mais 7 dias)
    const { data: signedUrlData, error: urlError } = await supabase
        .storage
        .from('apostilas')
        .createSignedUrl(product.pdf_filename, 604800);

    if (urlError) throw new Error("Erro ao gerar novo link PDF.");

    // 4. Reenvia o E-mail
    console.log(`📧 Reenviando para: ${sale.customer_email}`);

    await resend.emails.send({
        from: 'Feltro Fácil <nao-responda@loja.feltrofacil.com.br>',
        to: [sale.customer_email],
        reply_to: 'wilsonglopes@gmail.com',
        subject: `(Reenvio) Sua apostila chegou! 🎁 - ${product.title}`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333; background-color: #f9f9f9; border-radius: 10px;">
                <h2 style="color: #660066;">Aqui está sua apostila (Novamente!)</h2>
                <p>Olá,</p>
                <p>Recebemos sua solicitação de reenvio para a apostila <strong>${product.title}</strong>.</p>
                <p>Segue abaixo seu novo link de download:</p>
                <br>
                <div style="text-align: center;">
                    <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold;">BAIXAR AGORA ⬇️</a>
                </div>
                <br><br>
                <p style="font-size: 12px; color: #777;">
                    Link válido por 7 dias.<br>
                    Se precisar de ajuda, responda a este e-mail.
                </p>
            </div>
        `
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "E-mail reenviado com sucesso!" }),
    };

  } catch (error) {
    console.error("Erro no Reenvio:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
