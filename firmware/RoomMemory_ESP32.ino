/*
 Room Memory ESP32 firmware starter
 Hardware:
 ST7789: CS 5, DC 21, RST 22, MOSI 23, MISO 19, SCLK 18 (landscape)
 BMP280: SDA 25, SCL 26, CSB 3.3V, SDO GND (0x76/0x77)
 DHT11 DATA 4; LDR DO 34; rain AO 35; button 27 to GND.
 This is a cloud-connectivity prototype, NOT production-signed OTA.
 */
#include <WiFi.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Adafruit_BMP280.h>
#include <DHT.h>

const char* WIFI_SSID = "CHANGE_ME";
const char* WIFI_PASSWORD = "CHANGE_ME";
// Local development: use the computer's LAN IP, not localhost.
const char* MQTT_HOST = "10.212.30.17";
const int MQTT_PORT = 1883;
const char* MQTT_USER = "";
const char* MQTT_PASSWORD = "";
const char* DEVICE_ID = "RM-REPLACE-WITH-PROVISIONED-ID";
String TELEMETRY_TOPIC;
String STATUS_TOPIC;
String COMMAND_TOPIC;
String ACK_TOPIC;

#define TFT_CS 5
#define TFT_DC 21
#define TFT_RST 22
#define TFT_MOSI 23
#define TFT_MISO 19
#define TFT_SCLK 18
#define BMP_SDA 25
#define BMP_SCL 26
#define DHT_PIN 4
#define LDR_DO_PIN 34
#define RAIN_AO_PIN 35
#define BUTTON_PIN 27
#define DHT_TYPE DHT11

Adafruit_ST7789 tft(TFT_CS, TFT_DC, TFT_RST);
Adafruit_BMP280 bmp;
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient mqttClient;
PubSubClient mqtt(mqttClient);

float tDht=NAN, hum=NAN, tBmp=NAN, pressure=NAN;
int ldrState=HIGH, rainRaw=0, rainPct=0;
bool bmpOK=false, dhtOK=false, standbyMode=false;
unsigned long lastRead=0, lastPublish=0, lastButton=0;
int lastButtonState=HIGH;
const int RAIN_DRY_RAW=3800, RAIN_WET_RAW=900;

int rainPercent(int raw){ return constrain((int)map(raw,RAIN_DRY_RAW,RAIN_WET_RAW,0,100),0,100); }

void drawScreen(){
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0,0,320,28,0x03EF);
  tft.setTextColor(ST77XX_WHITE); tft.setTextSize(2); tft.setCursor(7,6); tft.print("ROOM MEMORY");
  tft.setTextSize(1);
  tft.setCursor(8,42); tft.printf("DHT11: %s",dhtOK?"OK":"ERROR");
  tft.setCursor(8,62); tft.printf("Temperature: %.1f C",tDht);
  tft.setCursor(8,82); tft.printf("Humidity: %.1f %%",hum);
  tft.setCursor(8,102); tft.printf("BMP280: %s",bmpOK?"OK":"ERROR");
  tft.setCursor(8,122); tft.printf("Pressure: %.1f hPa",pressure);
  tft.setCursor(8,142); tft.printf("LDR DO GPIO34: %s",ldrState==LOW?"LOW":"HIGH");
  tft.setCursor(8,162); tft.printf("Rain wetness: %d%% raw=%d",rainPct,rainRaw);
  if ((dhtOK && tDht>=35) || (dhtOK && hum>=80) || (rainPct>=70)) {
    tft.fillRect(0,202,320,30,ST77XX_RED);
    tft.setTextColor(ST77XX_WHITE); tft.setCursor(8,213);
    if (dhtOK && tDht>=35) tft.print("ALERT: HIGH TEMPERATURE");
    else if (dhtOK && hum>=80) tft.print("ALERT: HIGH HUMIDITY");
    else tft.print("ALERT: VERY WET SENSOR");
  }
  if(standbyMode){tft.fillRect(0,0,320,240,ST77XX_BLACK);tft.setTextColor(ST77XX_YELLOW);tft.setCursor(85,110);tft.print("STANDBY");}
}

void publishTelemetry(){
  char payload[320];
  snprintf(payload,sizeof(payload),
    "{\"deviceId\":\"%s\",\"firmware\":\"0.1.0\",\"dhtOK\":%s,\"bmpOK\":%s,\"dhtTemp\":%.2f,\"humidity\":%.2f,\"bmpTemp\":%.2f,\"pressureHpa\":%.2f,\"ldrDO\":%d,\"rainRaw\":%d,\"rainWetnessPct\":%d,\"standby\":%s}",
    DEVICE_ID,dhtOK?"true":"false",bmpOK?"true":"false",tDht,hum,tBmp,pressure,ldrState,rainRaw,rainPct,standbyMode?"true":"false");
  mqtt.publish(TELEMETRY_TOPIC.c_str(),payload);
}
void mqttCallback(char* topic, byte* payload, unsigned int len){
  String msg; for(unsigned int i=0;i<len;i++) msg+=(char)payload[i];
  // Replace with strict JSON parsing, per-command authorization and command IDs.
  if(msg.indexOf("\"type\":\"standby\"")>=0) standbyMode=true;
  else if(msg.indexOf("\"type\":\"wake\"")>=0) standbyMode=false;
  else if(msg.indexOf("\"type\":\"refresh\"")>=0) drawScreen();
  // Do not implement arbitrary relay/power commands without hardware safety design.
  drawScreen();
  String ack=String("{\"deviceId\":\"")+DEVICE_ID+"\",\"received\":true}";
  mqtt.publish(ACK_TOPIC.c_str(),ack.c_str());
}
void connectMqtt(){
  if(WiFi.status()!=WL_CONNECTED || mqtt.connected()) return;
  String clientId=String("rm-")+DEVICE_ID;
  if(mqtt.connect(clientId.c_str(),MQTT_USER,MQTT_PASSWORD,STATUS_TOPIC,1,true,"{\"online\":false}")){
    mqtt.publish(STATUS_TOPIC.c_str(),"{\"online\":true,\"firmware\":\"0.1.0\"}",true);
    mqtt.subscribe(COMMAND_TOPIC.c_str());
  }
}
void setup(){
  Serial.begin(115200);
  pinMode(LDR_DO_PIN,INPUT); pinMode(BUTTON_PIN,INPUT_PULLUP);
  analogReadResolution(12); analogSetPinAttenuation(RAIN_AO_PIN,ADC_11db);
  dht.begin(); Wire.begin(BMP_SDA,BMP_SCL);
  bmpOK=bmp.begin(0x76); if(!bmpOK) bmpOK=bmp.begin(0x77);
  SPI.begin(TFT_SCLK,TFT_MISO,TFT_MOSI,TFT_CS);
  tft.init(240,320); tft.setRotation(1); drawScreen();

  // Build all MQTT topics from this device's provisioned ID.
  String deviceRoot = String("roommemory/v1/devices/") + DEVICE_ID;
  TELEMETRY_TOPIC = deviceRoot + "/telemetry";
  STATUS_TOPIC = deviceRoot + "/status";
  COMMAND_TOPIC = deviceRoot + "/commands";
  ACK_TOPIC = deviceRoot + "/command-ack";

  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  while(WiFi.status()!=WL_CONNECTED){delay(500);Serial.print(".");}
  Serial.println(WiFi.localIP());
  mqtt.setServer(MQTT_HOST,MQTT_PORT); mqtt.setCallback(mqttCallback);
}
void loop(){
  if(WiFi.status()!=WL_CONNECTED){WiFi.reconnect();delay(50);}
  connectMqtt(); mqtt.loop();
  int b=digitalRead(BUTTON_PIN);
  if(b==LOW && lastButtonState==HIGH && millis()-lastButton>250){
    lastButton=millis(); Serial.println("BUTTON PRESSED");
    standbyMode=!standbyMode; drawScreen();
  }
  lastButtonState=b;
  if(millis()-lastRead>=2000){
    lastRead=millis();
    float h=dht.readHumidity(), t=dht.readTemperature();
    dhtOK=!isnan(h)&&!isnan(t); if(dhtOK){hum=h;tDht=t;}
    if(bmpOK){tBmp=bmp.readTemperature();pressure=bmp.readPressure()/100.0f;}
    ldrState=digitalRead(LDR_DO_PIN); rainRaw=analogRead(RAIN_AO_PIN); rainPct=rainPercent(rainRaw);
    if(!standbyMode) drawScreen();
    if(dhtOK && (tDht>=35 || hum>=80)) Serial.println("ALERT: threshold exceeded");
    if(!dhtOK) Serial.println("ERROR: DHT11 read failed");
    if(!bmpOK) Serial.println("ERROR: BMP280 not found");
  }
  if(millis()-lastPublish>=5000){lastPublish=millis();if(mqtt.connected())publishTelemetry();}
}
