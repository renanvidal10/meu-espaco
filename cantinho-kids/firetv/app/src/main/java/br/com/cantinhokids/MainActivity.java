package br.com.cantinhokids;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Cantinho Kids no Fire TV.
 *
 * Mostra a mesma vitrine da pasta cantinho-kids (que vai dentro do app) e
 * acrescenta o que um site não consegue fazer: abrir o filme direto no app
 * do Prime Video, Disney+ ou Netflix que já está logado na TV.
 */
public class MainActivity extends Activity {

    // Endereço "de mentira" reservado pelo Android para servir arquivos do próprio app.
    // Precisa ser https: o YouTube recusa tocar vídeo em página sem endereço de verdade.
    private static final String HOST = "appassets.androidplatform.net";
    private static final String INICIO = "https://" + HOST + "/index.html";

    // A lista de vídeos é baixada do GitHub toda vez que o app abre.
    // Assim, editar o videos.js no GitHub muda a TV sem reinstalar nada.
    private static final String[] LISTAS = {
        "https://raw.githubusercontent.com/renanvidal10/meu-espaco/main/cantinho-kids/videos.js",
        "https://raw.githubusercontent.com/renanvidal10/meu-espaco/cantinho-kids/cantinho-kids/videos.js"
    };

    private static final String NAVEGADOR =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

    private WebView web;
    private SharedPreferences guardado;
    private final ExecutorService fila = Executors.newFixedThreadPool(3);

    @Override
    protected void onCreate(Bundle salvo) {
        super.onCreate(salvo);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        guardado = getSharedPreferences("cantinho", MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(0xFF16183D);
        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Cliente());
        web.addJavascriptInterface(new Ponte(), "CantinhoNativo");
        setContentView(web);
        esconderBarras();

        fila.execute(new Runnable() {
            @Override public void run() {
                baixarLista();
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        web.loadUrl(INICIO);
                        web.requestFocus();
                    }
                });
            }
        });
    }

    private void esconderBarras() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        esconderBarras();
    }

    @Override
    protected void onPause() {
        // Sem isso o som do YouTube continuaria tocando com o app fechado.
        web.onPause();
        super.onPause();
    }

    // Botão Voltar: primeiro fecha o vídeo ou o aviso aberto; na tela inicial, sai do app.
    @Override
    public boolean dispatchKeyEvent(KeyEvent evento) {
        if (evento.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (evento.getAction() == KeyEvent.ACTION_UP) {
                web.evaluateJavascript(
                    "window.cantinhoVoltar ? window.cantinhoVoltar() : false",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String fechou) {
                            if (!"true".equals(fechou)) finish();
                        }
                    });
            }
            return true;
        }
        return super.dispatchKeyEvent(evento);
    }

    // ---------- Lista de vídeos ----------

    private File listaBaixada() {
        return new File(getFilesDir(), "videos.js");
    }

    private void baixarLista() {
        for (String endereco : LISTAS) {
            try {
                byte[] dados = baixar(endereco + "?t=" + System.currentTimeMillis(), 4000, 512 * 1024);
                if (dados != null && new String(dados, "UTF-8").contains("CANTINHO")) {
                    FileOutputStream saida = new FileOutputStream(listaBaixada());
                    saida.write(dados);
                    saida.close();
                    return;
                }
            } catch (Exception e) {
                // Sem internet ou endereço fora do ar: tenta o próximo, ou usa a última lista guardada.
            }
        }
    }

    private static byte[] baixar(String endereco, int tempo, int limite) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(endereco).openConnection();
        con.setConnectTimeout(tempo);
        con.setReadTimeout(tempo);
        con.setInstanceFollowRedirects(true);
        con.setRequestProperty("User-Agent", NAVEGADOR);
        con.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9");
        try {
            if (con.getResponseCode() != 200) return null;
            InputStream entrada = con.getInputStream();
            ByteArrayOutputStream juntos = new ByteArrayOutputStream();
            byte[] pedaco = new byte[16384];
            int lidos;
            while ((lidos = entrada.read(pedaco)) != -1 && juntos.size() < limite) {
                juntos.write(pedaco, 0, lidos);
            }
            entrada.close();
            return juntos.toByteArray();
        } finally {
            con.disconnect();
        }
    }

    // ---------- Arquivos da vitrine ----------

    private class Cliente extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest pedido) {
            Uri uri = pedido.getUrl();
            if (!HOST.equals(uri.getHost())) return null;
            String caminho = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
            if (caminho.isEmpty()) caminho = "index.html";
            try {
                InputStream dados;
                if (caminho.equals("videos.js") && listaBaixada().exists()) {
                    dados = new FileInputStream(listaBaixada());
                } else {
                    dados = getAssets().open("site/" + caminho);
                }
                return new WebResourceResponse(tipo(caminho), "utf-8", dados);
            } catch (Exception e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Nao encontrado", null, null);
            }
        }

        // Ninguém sai da vitrine: clique em logo do YouTube ou link solto não abre nada.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest pedido) {
            return !HOST.equals(pedido.getUrl().getHost());
        }
    }

    private static String tipo(String caminho) {
        if (caminho.endsWith(".html")) return "text/html";
        if (caminho.endsWith(".css")) return "text/css";
        if (caminho.endsWith(".js")) return "application/javascript";
        if (caminho.endsWith(".svg")) return "image/svg+xml";
        if (caminho.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    // ---------- Ponte com a vitrine (chamada pelo app.js) ----------

    private class Ponte {

        /** Abre o filme no app do streaming. Devolve "ok:N" (N = jeito que funcionou) ou "erro". */
        @JavascriptInterface
        public String abrir(String link, String servico, String titulo) {
            List<Intent> tentativas = jeitosDeAbrir(link);
            for (int i = 0; i < tentativas.size(); i++) {
                try {
                    startActivity(tentativas.get(i));
                    final String aviso = servico + ": jeito " + (i + 1) + " de " + tentativas.size();
                    if (modoTeste()) mostrar(aviso);
                    guardado.edit().putString("ultimo", link + " | " + aviso).apply();
                    return "ok:" + (i + 1);
                } catch (ActivityNotFoundException e) {
                    // Esse jeito não existe nesta TV; tenta o próximo.
                } catch (SecurityException e) {
                    // O app não aceita ser aberto assim; tenta o próximo.
                }
            }
            return "erro: nenhum dos " + tentativas.size() + " jeitos funcionou";
        }

        /** Capa oficial do filme (imagem da página de compartilhamento). Guarda para não buscar de novo. */
        @JavascriptInterface
        public String buscarCapa(final String link) {
            final String chave = "capa:" + link;
            String pronta = guardado.getString(chave, "");
            if (!pronta.isEmpty()) return pronta;
            fila.execute(new Runnable() {
                @Override public void run() {
                    final String capa = acharCapa(link);
                    if (capa == null) return;
                    guardado.edit().putString(chave, capa).apply();
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            web.evaluateJavascript("window.cantinhoCapa && window.cantinhoCapa("
                                + JSONObject.quote(link) + "," + JSONObject.quote(capa) + ")", null);
                        }
                    });
                }
            });
            return "";
        }

        @JavascriptInterface
        public void ligarModoTeste(boolean ligado) {
            guardado.edit().putBoolean("modoTeste", ligado).apply();
        }
    }

    private boolean modoTeste() {
        return guardado.getBoolean("modoTeste", false);
    }

    private void mostrar(final String texto) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, texto, Toast.LENGTH_LONG).show();
            }
        });
    }

    private static final Pattern OG_IMAGE = Pattern.compile(
        "<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']"
            + "|<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']",
        Pattern.CASE_INSENSITIVE);

    private static String acharCapa(String link) {
        try {
            byte[] pagina = baixar(link, 8000, 1500 * 1024);
            if (pagina == null) return null;
            Matcher achou = OG_IMAGE.matcher(new String(pagina, "UTF-8"));
            if (!achou.find()) return null;
            String url = achou.group(1) != null ? achou.group(1) : achou.group(2);
            return url.replace("&amp;", "&");
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- Como abrir cada streaming ----------
    // Cada app de streaming entende links de um jeito, e isso muda entre
    // Fire TV e Android comum. Então a lista tenta vários jeitos, do mais
    // direto (já cai no filme) ao mais simples (só abre o app).

    private static final String[] PRIME = {"com.amazon.firebat", "com.amazon.avod.thirdpartyclient", "com.amazon.avod"};
    private static final String[] DISNEY = {"com.disney.disneyplus"};
    private static final String[] NETFLIX = {"com.netflix.ninja", "com.netflix.mediaclient"};

    private List<Intent> jeitosDeAbrir(String link) {
        List<Intent> lista = new ArrayList<>();
        String minusculo = link.toLowerCase();
        Uri uri = Uri.parse(link);

        if (minusculo.contains("primevideo") || minusculo.contains("amazon.")) {
            String gti = uri.getQueryParameter("gti");
            if (gti == null) gti = trecho(link, "(amzn1\\.dv\\.gti\\.[0-9a-f-]+)");
            for (String app : PRIME) {
                if (gti != null) {
                    lista.add(ver("https://app.primevideo.com/detail?gti=" + gti, app));
                    lista.add(ver("https://watch.amazon.com/detail?gti=" + gti, app));
                    lista.add(ver("https://www.primevideo.com/detail/" + gti, app));
                }
                lista.add(ver(link, app));
            }
            abrirApp(lista, PRIME);
        } else if (minusculo.contains("disneyplus")) {
            String limpo = link.replaceFirst("^https?://(www\\.)?disneyplus\\.com", "https://www.disneyplus.com")
                .replaceFirst("\\?.*$", "");
            for (String app : DISNEY) {
                lista.add(ver(limpo, app));
                lista.add(ver(link, app));
            }
            abrirApp(lista, DISNEY);
        } else if (minusculo.contains("netflix")) {
            String id = trecho(link, "/(?:title|watch)/(\\d+)");
            for (String app : NETFLIX) {
                if (id != null) {
                    Intent assistir = ver("https://www.netflix.com/watch/" + id, app);
                    assistir.putExtra("source", "30"); // pedido do próprio app da Netflix para abrir direto
                    lista.add(assistir);
                    lista.add(ver("netflix://title/" + id, app));
                }
                lista.add(ver(link, app));
            }
            abrirApp(lista, NETFLIX);
        } else {
            // Outro streaming: o Android escolhe o app que reconhece o link.
            lista.add(ver(link, null));
        }
        return lista;
    }

    private static Intent ver(String endereco, String app) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(endereco));
        if (app != null) intent.setPackage(app);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    private void abrirApp(List<Intent> lista, String[] apps) {
        for (String app : apps) {
            Intent abrir = getPackageManager().getLeanbackLaunchIntentForPackage(app);
            if (abrir == null) abrir = getPackageManager().getLaunchIntentForPackage(app);
            if (abrir != null) lista.add(abrir);
        }
    }

    private static String trecho(String texto, String padrao) {
        Matcher achou = Pattern.compile(padrao).matcher(texto);
        return achou.find() ? achou.group(1) : null;
    }
}
