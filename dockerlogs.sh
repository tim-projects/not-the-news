sudo docker logs -f ntn &
pid=$!
sleep 60
kill $pid
