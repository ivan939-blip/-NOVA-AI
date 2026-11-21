package ai.nova.studio;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
  private TextToSpeech tts;
  private SpeechRecognizer recognizer;
  private boolean cancelled = false;
  private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

  @Override public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    tts = new TextToSpeech(this, status -> {
      if (status == TextToSpeech.SUCCESS) {
        Locale ukrainian = new Locale("uk", "UA");
        int support = tts.isLanguageAvailable(ukrainian);
        if (support >= TextToSpeech.LANG_AVAILABLE) {
          tts.setLanguage(ukrainian);
          for (android.speech.tts.Voice voice : tts.getVoices()) {
            if ("uk".equals(voice.getLocale().getLanguage()) && !voice.isNetworkConnectionRequired()) {
              tts.setVoice(voice);
              break;
            }
          }
        }
        tts.setSpeechRate(0.92f);
        tts.setPitch(1.04f);
      }
    });
    handler.postDelayed(() -> {
      WebView web = getBridge().getWebView();
      if (web != null) web.addJavascriptInterface(new VoiceBridge(), "NovaVoice");
    }, 250);
  }
  private void emit(String type, String value) {
    String js = "window.dispatchEvent(new CustomEvent('nova-native-voice',{detail:{type:"+
      org.json.JSONObject.quote(type)+",value:"+org.json.JSONObject.quote(value)+"}}));";
    runOnUiThread(() -> { if(getBridge()!=null && getBridge().getWebView()!=null) getBridge().getWebView().evaluateJavascript(js,null); });
  }
  public class VoiceBridge {
    @JavascriptInterface public void speak(String text) {
      runOnUiThread(() -> {
        if(tts == null){emit("speech-error","TTS unavailable");return;}
        tts.stop();
        tts.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener(){
          @Override public void onStart(String id){emit("speech-start","");}
          @Override public void onDone(String id){emit("speech-end","");}
          @Override public void onError(String id){emit("speech-error","Android TTS error");}
        });
        String spoken = text.replaceAll("\\s+", " ").trim();
        if (spoken.isEmpty()) { emit("speech-end",""); return; }
        int result = tts.speak(spoken,TextToSpeech.QUEUE_FLUSH,null,"nova-reply");
        if(result == TextToSpeech.ERROR) emit("speech-error","Не вдалося запустити озвучення.");
      });
    }
    @JavascriptInterface public void stopSpeaking(){runOnUiThread(() -> {if(tts!=null)tts.stop();});}
    @JavascriptInterface public void listen(){
      runOnUiThread(() -> {
        cancelled=false;
        if(ActivityCompat.checkSelfPermission(MainActivity.this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
          ActivityCompat.requestPermissions(MainActivity.this,new String[]{Manifest.permission.RECORD_AUDIO},121);
          emit("recognition-error","Дозволь доступ до мікрофона і натисни «Почати» ще раз.");
          return;
        }
        if(!SpeechRecognizer.isRecognitionAvailable(MainActivity.this)){
          emit("recognition-error","На Android немає служби розпізнавання голосу.");
          return;
        }
        if(recognizer!=null){recognizer.destroy();recognizer=null;}
        recognizer=SpeechRecognizer.createSpeechRecognizer(MainActivity.this);
        recognizer.setRecognitionListener(new RecognitionListener(){
          @Override public void onReadyForSpeech(Bundle b){emit("recognition-start","");}
          @Override public void onBeginningOfSpeech(){}
          @Override public void onRmsChanged(float rms){}
          @Override public void onBufferReceived(byte[] b){}
          @Override public void onEndOfSpeech(){}
          @Override public void onError(int error){if(!cancelled)emit("recognition-error",String.valueOf(error));}
          @Override public void onResults(Bundle results){
            if(cancelled)return;
            ArrayList<String> words=results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            emit("recognition-result",words!=null&&!words.isEmpty()?words.get(0):"");
          }
          @Override public void onPartialResults(Bundle b){}
          @Override public void onEvent(int type,Bundle b){}
        });
        Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"uk-UA");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,false);
        recognizer.startListening(intent);
      });
    }
    @JavascriptInterface public void stopListening(){runOnUiThread(() -> {cancelled=true;if(recognizer!=null){recognizer.cancel();recognizer.destroy();recognizer=null;}});}
  }
  @Override public void onDestroy(){if(recognizer!=null)recognizer.destroy();if(tts!=null){tts.stop();tts.shutdown();}super.onDestroy();}
}
