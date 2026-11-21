package main

import (
	"log"
	"net/http"
	"os"

	"lanroom/manage/internal/api"
)

func main() {
	server, err := api.New(api.ConfigFromEnv())
	if err != nil {
		log.Fatal(err)
	}
	addr := os.Getenv("PORT")
	if addr == "" {
		addr = "8080"
	}
	if addr[0] != ':' {
		addr = ":" + addr
	}
	log.Printf("lanroom manage listening %s", addr)
	log.Fatal(http.ListenAndServe(addr, server.Handler()))
}
