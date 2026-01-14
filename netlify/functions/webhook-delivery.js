const mercadopago = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

exports.handler = async function(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);
  mercadopago.configurations.setAccessToken(process.env.MP_ACCESS_TOKEN);

  // O MP envia parâmetros na query ou no body dependendo da configuração
  const topic = event.queryStringParameters?.topic || event.queryStringParameters?.type;
  const id = event.queryStringParameters?.id || event.queryStringParameters?.data_id;

  if (topic === 'payment') {
    try {
      // 1. Verificar status do pagamento no MP
      const payment = await mercadopago.payment.get(id);
      const paymentData = payment.body;

      if (paymentData.status === 'approved') {
        const productId = paymentData.external_reference;
        const customerEmail = paymentData.payer.email;

        console.log(`Pagamento aprovado: ${id} | Email: ${customerEmail} | Produto: ${productId}`);

        // 2. Buscar qual arquivo entregar
        const { data: product } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single();

        if (!product) throw new Error('Produto vendido não existe no banco.');

        // 3. Registrar a venda
        await supabase.from('sales').insert({
          payment_id: String(id),
          customer_email: customerEmail,
          product_id: productId,
          amount: paymentData.transaction_amount,
          status: 'approved'
        });

        // 4. Gerar Link Seguro (Assinado) válido por 7 dias (604800 segundos)
        const { data: signedUrlData, error: signError } = await supabase
          .storage
          .from('apostilas')
          .createSignedUrl(product.pdf_filename, 604800);

        if (signError) throw new Error('Erro ao gerar link do arquivo.');

        const downloadLink = signedUrlData.signedUrl;

        // 5. Enviar E-mail com Resend
        await resend.emails.send({
          from: 'Feltro Fácil <loja@feltrofacil.com.br>', // Configure seu domínio no Resend
          to: [customerEmail],
          subject: `Seu arquivo chegou! 🎁 - ${product.title}`,
          html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #ec4899;">Obrigado pela compra!</h1>
              <p>Olá,</p>
              <p>O pagamento da sua apostila <strong>${product.title}</strong> foi confirmado.</p>
              <p>Clique no botão abaixo para baixar o seu PDF. O link é válido por 7 dias.</p>
              <br>
              <a href="${downloadLink}" style="background-color: #ec4899; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">BAIXAR APOSTILA AGORA</a>
              <br><br>
              <p style="font-size: 12px; color: #666;">Se o botão não funcionar, copie e cole este link: ${downloadLink}</p>
              <hr>
              <p style="font-size: 12px;">Equipe Feltro Fácil</p>
            </div>
          `
        });

        return { statusCode: 200, body: 'Entrega realizada com sucesso.' };
      }
    } catch (error) {
      console.error('Erro no webhook:', error);
      return { statusCode: 500, body: error.message };
    }
  }

  return { statusCode: 200, body: 'OK' };
};
